//! Pictures from the operating system's own decoders, for formats Picaluma doesn't decode itself:
//! HEIC/HEIF, AVIF and PSD, RAW files without a usable preview, and video frames.
//!
//! - Windows: the Shell thumbnail engine Explorer uses (IShellItemImageFactory), so whatever
//!   codecs the PC has (HEIF/AV1/Raw Image Extensions, video codecs) just work.
//! - macOS: `sips` (ImageIO) for pictures and Quick Look (`qlmanage`) for video frames.
//! - Linux: `ffmpeg` for video frames when it's installed.
//!
//! Results come back upright (orientation already applied).

use image::DynamicImage;

/// A still picture decoded by the system, at most `edge` pixels on its longest side.
pub fn system_image(path: &str, edge: u32) -> Result<DynamicImage, String> {
  imp::image(path, edge)
}

/// A representative frame of a video, at most `edge` pixels on its longest side.
pub fn video_frame(path: &str, edge: u32) -> Result<DynamicImage, String> {
  imp::video(path, edge)
}

#[cfg(windows)]
mod imp {
  use image::{DynamicImage, RgbImage};
  use windows::core::PCWSTR;
  use windows::Win32::Foundation::SIZE;
  use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
  };
  use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
  use windows::Win32::UI::Shell::{IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK, SIIGBF_RESIZETOFIT, SIIGBF_THUMBNAILONLY};

  pub fn image(path: &str, edge: u32) -> Result<DynamicImage, String> {
    shell(path, edge)
  }

  pub fn video(path: &str, edge: u32) -> Result<DynamicImage, String> {
    shell(path, edge)
  }

  /// Explorer's thumbnail for the file. THUMBNAILONLY: fail rather than return the file-type icon
  /// when no codec is installed.
  fn shell(path: &str, edge: u32) -> Result<DynamicImage, String> {
    let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
    unsafe {
      // Thumbnail workers are plain threads; joining the multithreaded apartment is cheap and
      // harmless if it's already joined.
      let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
      let factory: IShellItemImageFactory = SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None).map_err(|e| e.to_string())?;
      let size = SIZE { cx: edge as i32, cy: edge as i32 };
      let hbmp = factory
        .GetImage(size, SIIGBF_RESIZETOFIT | SIIGBF_BIGGERSIZEOK | SIIGBF_THUMBNAILONLY)
        .map_err(|e| format!("no Windows thumbnail ({e})"))?;
      let obj = HGDIOBJ(hbmp.0);
      let mut bm = BITMAP::default();
      if GetObjectW(obj, std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut BITMAP as *mut _)) == 0 {
        let _ = DeleteObject(obj);
        return Err("unreadable thumbnail bitmap".into());
      }
      let (w, h) = (bm.bmWidth.max(1), bm.bmHeight.abs().max(1));
      let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
          biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
          biWidth: w,
          biHeight: -h, // top-down rows
          biPlanes: 1,
          biBitCount: 32,
          biCompression: BI_RGB.0,
          ..Default::default()
        },
        ..Default::default()
      };
      let mut bgra = vec![0u8; (w * h * 4) as usize];
      let dc = CreateCompatibleDC(None);
      let rows = GetDIBits(dc, hbmp, 0, h as u32, Some(bgra.as_mut_ptr() as *mut _), &mut info, DIB_RGB_COLORS);
      let _ = DeleteDC(dc);
      let _ = DeleteObject(obj);
      if rows == 0 {
        return Err("could not read thumbnail pixels".into());
      }
      let mut rgb = RgbImage::new(w as u32, h as u32);
      for (px, src) in rgb.pixels_mut().zip(bgra.chunks_exact(4)) {
        *px = image::Rgb([src[2], src[1], src[0]]);
      }
      Ok(DynamicImage::ImageRgb8(rgb))
    }
  }
}

#[cfg(target_os = "macos")]
mod imp {
  use image::DynamicImage;
  use std::process::{Command, Stdio};
  use std::sync::atomic::{AtomicU64, Ordering};

  static SEQ: AtomicU64 = AtomicU64::new(0);

  fn temp(ext: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("picaluma-{}-{}.{ext}", std::process::id(), SEQ.fetch_add(1, Ordering::Relaxed)))
  }

  /// `sips` converts anything ImageIO reads (HEIC, AVIF, PSD, RAW) to JPEG.
  pub fn image(path: &str, edge: u32) -> Result<DynamicImage, String> {
    let out = temp("jpg");
    let status = Command::new("sips")
      .args(["-s", "format", "jpeg", "-s", "formatOptions", "85", "-Z", &edge.to_string(), path, "--out"])
      .arg(&out)
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .status()
      .map_err(|e| format!("sips: {e}"))?;
    let bytes = std::fs::read(&out).map_err(|e| format!("sips produced no output ({status}): {e}"));
    let _ = std::fs::remove_file(&out);
    let bytes = bytes?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    // sips may or may not rotate the pixels; trust the converted JPEG's own orientation tag.
    let o = crate::thumbs::exif_orientation(&bytes).unwrap_or(1);
    Ok(crate::thumbs::apply_orientation(img, o))
  }

  /// Quick Look renders a frame of any video macOS can play.
  pub fn video(path: &str, edge: u32) -> Result<DynamicImage, String> {
    let dir = temp("ql");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let _ = Command::new("qlmanage")
      .args(["-t", "-s", &edge.to_string(), "-o"])
      .arg(&dir)
      .arg(path)
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .status();
    let png = std::fs::read_dir(&dir).ok().and_then(|mut d| d.find_map(|e| e.ok().map(|e| e.path())));
    let result = match png {
      Some(p) => image::open(&p).map_err(|e| e.to_string()),
      None => Err("Quick Look made no thumbnail".into()),
    };
    let _ = std::fs::remove_dir_all(&dir);
    result
  }
}

#[cfg(all(unix, not(target_os = "macos")))]
mod imp {
  use image::DynamicImage;
  use std::process::{Command, Stdio};

  pub fn image(_path: &str, _edge: u32) -> Result<DynamicImage, String> {
    Err("this format needs a system decoder, which isn't available on Linux".into())
  }

  /// A frame one second in (or the first frame for very short clips), via ffmpeg if installed.
  pub fn video(path: &str, edge: u32) -> Result<DynamicImage, String> {
    for at in ["1", "0"] {
      let out = Command::new("ffmpeg")
        .args(["-v", "error", "-ss", at, "-i", path, "-frames:v", "1", "-vf"])
        .arg(format!("scale='min({edge},iw)':-2"))
        .args(["-f", "image2pipe", "-vcodec", "mjpeg", "-"])
        .stderr(Stdio::null())
        .output();
      if let Ok(o) = out {
        if !o.stdout.is_empty() {
          return image::load_from_memory(&o.stdout).map_err(|e| e.to_string());
        }
      }
    }
    Err("no video frame (install ffmpeg for video thumbnails)".into())
  }
}
