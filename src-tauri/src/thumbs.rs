use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};

use image::{imageops, DynamicImage, ImageBuffer, Luma, Rgb};
use tauri::http::{Request, Response};
use tauri::{AppHandle, Manager};

use crate::AppState;

/// Longest edge of cached thumbnails. Large enough for the biggest grid slider setting.
const THUMB_EDGE: u32 = 360;
const THUMB_QUALITY: u8 = 85;

struct PhotoRef {
  path: String,
  mtime: i64,
  orientation: i64,
}

pub fn handle_thumb(app: &AppHandle, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
  let Some(id) = parse_id(req) else { return not_found() };
  let Some(photo) = lookup(app, id) else { return not_found() };
  let cache = cache_path(&app.state::<AppState>().thumb_dir, id, photo.mtime);
  if let Ok(bytes) = std::fs::read(&cache) {
    return image_response(bytes, "image/jpeg");
  }
  match build_thumb(Path::new(&photo.path), photo.orientation) {
    Ok(bytes) => {
      if let Some(dir) = cache.parent() {
        let _ = std::fs::create_dir_all(dir);
      }
      let _ = std::fs::write(&cache, &bytes);
      image_response(bytes, "image/jpeg")
    }
    Err(e) => {
      log::warn!("thumb {}: {e}", photo.path);
      not_found()
    }
  }
}

pub fn handle_photo(app: &AppHandle, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
  let Some(id) = parse_id(req) else { return not_found() };
  let Some(photo) = lookup(app, id) else { return not_found() };
  match std::fs::read(&photo.path) {
    Ok(bytes) => image_response(bytes, mime_for(&photo.path)),
    Err(_) => not_found(),
  }
}

fn parse_id(req: &Request<Vec<u8>>) -> Option<i64> {
  req.uri().path().trim_matches('/').split('/').next()?.parse().ok()
}

fn lookup(app: &AppHandle, id: i64) -> Option<PhotoRef> {
  let state = app.state::<AppState>();
  let conn = state.db.lock().ok()?;
  conn
    .query_row("SELECT path, mtime, orientation FROM photos WHERE id = ?1", [id], |r| {
      Ok(PhotoRef { path: r.get(0)?, mtime: r.get(1)?, orientation: r.get(2)? })
    })
    .ok()
}

fn cache_path(dir: &Path, id: i64, mtime: i64) -> PathBuf {
  dir.join(format!("{:03}", id % 1000)).join(format!("{id}_{mtime}.jpg"))
}

fn build_thumb(path: &Path, orientation: i64) -> Result<Vec<u8>, String> {
  let img = decode_scaled(path)?;
  let thumb = img.thumbnail(THUMB_EDGE, THUMB_EDGE);
  let thumb = apply_orientation(thumb, orientation);
  let mut out = Vec::new();
  let rgb = thumb.to_rgb8();
  image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, THUMB_QUALITY)
    .encode_image(&rgb)
    .map_err(|e| e.to_string())?;
  Ok(out)
}

/// JPEGs are decoded with DCT scaling (1/2..1/8) straight to near-thumbnail size,
/// which is several times faster than a full decode. Everything else goes through `image`.
fn decode_scaled(path: &Path) -> Result<DynamicImage, String> {
  let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
  if matches!(ext.as_str(), "jpg" | "jpeg" | "jpe") {
    if let Ok(img) = decode_jpeg_scaled(path) {
      return Ok(img);
    }
  }
  image::ImageReader::open(path)
    .map_err(|e| e.to_string())?
    .with_guessed_format()
    .map_err(|e| e.to_string())?
    .decode()
    .map_err(|e| e.to_string())
}

fn decode_jpeg_scaled(path: &Path) -> Result<DynamicImage, String> {
  let file = File::open(path).map_err(|e| e.to_string())?;
  let mut dec = jpeg_decoder::Decoder::new(BufReader::new(file));
  dec.read_info().map_err(|e| e.to_string())?;
  let (w, h) = dec.scale(THUMB_EDGE as u16, THUMB_EDGE as u16).map_err(|e| e.to_string())?;
  let pixels = dec.decode().map_err(|e| e.to_string())?;
  let info = dec.info().ok_or("no jpeg info")?;
  let (w, h) = (w as u32, h as u32);
  match info.pixel_format {
    jpeg_decoder::PixelFormat::RGB24 => ImageBuffer::<Rgb<u8>, _>::from_raw(w, h, pixels)
      .map(DynamicImage::ImageRgb8)
      .ok_or_else(|| "bad rgb buffer".into()),
    jpeg_decoder::PixelFormat::L8 => ImageBuffer::<Luma<u8>, _>::from_raw(w, h, pixels)
      .map(DynamicImage::ImageLuma8)
      .ok_or_else(|| "bad luma buffer".into()),
    _ => Err("unsupported jpeg pixel format".into()),
  }
}

fn apply_orientation(img: DynamicImage, orientation: i64) -> DynamicImage {
  match orientation {
    2 => DynamicImage::from(imageops::flip_horizontal(&img)),
    3 => img.rotate180(),
    4 => DynamicImage::from(imageops::flip_vertical(&img)),
    5 => DynamicImage::from(imageops::flip_horizontal(&img.rotate90())),
    6 => img.rotate90(),
    7 => DynamicImage::from(imageops::flip_horizontal(&img.rotate270())),
    8 => img.rotate270(),
    _ => img,
  }
}

fn mime_for(path: &str) -> &'static str {
  let lower = path.to_lowercase();
  match lower.rsplit('.').next().unwrap_or("") {
    "png" => "image/png",
    "gif" => "image/gif",
    "bmp" => "image/bmp",
    "webp" => "image/webp",
    "tif" | "tiff" => "image/tiff",
    _ => "image/jpeg",
  }
}

fn image_response(bytes: Vec<u8>, mime: &str) -> Response<Vec<u8>> {
  Response::builder()
    .header("Content-Type", mime)
    .header("Cache-Control", "max-age=31536000, immutable")
    .header("Access-Control-Allow-Origin", "*")
    .body(bytes)
    .unwrap()
}

fn not_found() -> Response<Vec<u8>> {
  Response::builder().status(404).header("Access-Control-Allow-Origin", "*").body(Vec::new()).unwrap()
}
