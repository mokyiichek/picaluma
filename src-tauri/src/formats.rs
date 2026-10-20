//! Which files Picaluma shows, and how each kind is decoded. Like Picasa's Options › File
//! Types, the optional formats can be switched off; unlike Picasa, HEIC/HEIF and AVIF are
//! supported too.

use std::collections::HashSet;
use std::path::Path;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

/// Always shown (Picasa had no switch for these either).
pub const STANDARD: &[&str] = &["jpg", "jpeg", "jpe", "jfif", "png", "gif", "bmp", "webp", "tif", "tiff"];
pub const HEIF: &[&str] = &["heic", "heif", "hif"];
pub const AVIF: &[&str] = &["avif"];
/// Camera RAW files. Their thumbnails come from the full-size JPEG preview the camera embeds.
pub const RAW: &[&str] = &[
  "cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2", "dng", "orf", "raf", "rw2", "rwl", "pef", "srw", "x3f", "3fr", "erf", "kdc", "mrw", "mos", "iiq",
];
pub const PSD: &[&str] = &["psd"];
pub const TGA: &[&str] = &["tga"];
pub const VIDEO: &[&str] = &["mp4", "m4v", "mov", "qt", "avi", "mkv", "wmv", "asf", "mpg", "mpeg", "m2v", "3gp", "3g2", "mts", "m2ts", "webm", "flv", "mod", "tod"];

/// Options › File Types. Everything is on by default.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct FileTypes {
  pub heif: bool,
  pub avif: bool,
  pub raw: bool,
  pub psd: bool,
  pub tga: bool,
  pub videos: bool,
}

impl Default for FileTypes {
  fn default() -> Self {
    Self { heif: true, avif: true, raw: true, psd: true, tga: true, videos: true }
  }
}

static ENABLED: RwLock<Option<HashSet<&'static str>>> = RwLock::new(None);

/// Sets which extensions the scanner and the live watcher pick up.
pub fn configure(t: &FileTypes) {
  let mut set: HashSet<&'static str> = STANDARD.iter().copied().collect();
  for (on, exts) in [(t.heif, HEIF), (t.avif, AVIF), (t.raw, RAW), (t.psd, PSD), (t.tga, TGA), (t.videos, VIDEO)] {
    if on {
      set.extend(exts.iter().copied());
    }
  }
  *ENABLED.write().unwrap() = Some(set);
}

fn ext(path: &Path) -> String {
  path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// A file Picaluma shows with the current File Types settings.
pub fn is_media(path: &Path) -> bool {
  let e = ext(path);
  match &*ENABLED.read().unwrap() {
    Some(set) => set.contains(e.as_str()),
    None => STANDARD.contains(&e.as_str()), // before configure(): the always-on set
  }
}

#[derive(PartialEq, Eq, Debug, Clone, Copy)]
pub enum Kind {
  /// Decoded by Picaluma itself (JPEG, PNG, GIF, BMP, TIFF, WebP, TGA).
  Image,
  /// Camera RAW: the embedded JPEG preview.
  Raw,
  /// Needs the operating system's decoder (HEIC/HEIF, AVIF, PSD).
  System,
  Video,
}

pub fn kind(path: &str) -> Kind {
  let e = ext(Path::new(path));
  let e = e.as_str();
  if VIDEO.contains(&e) {
    Kind::Video
  } else if RAW.contains(&e) {
    Kind::Raw
  } else if HEIF.contains(&e) || AVIF.contains(&e) || PSD.contains(&e) {
    Kind::System
  } else {
    Kind::Image
  }
}

pub fn is_video(path: &str) -> bool {
  kind(path) == Kind::Video
}

/// The largest JPEG embedded in a RAW file (cameras store a full-size preview), found by its
/// start marker and checked by decoding its header. Returns that JPEG's bytes.
pub fn raw_preview(src: &[u8]) -> Option<&[u8]> {
  let mut best: Option<(usize, u64)> = None;
  let mut i = 0;
  while i + 4 < src.len() {
    let Some(pos) = src[i..].windows(3).position(|w| w == [0xFF, 0xD8, 0xFF]) else { break };
    let at = i + pos;
    if let Ok(size) = imagesize::blob_size(&src[at..]) {
      let area = size.width as u64 * size.height as u64;
      if area > 160 * 120 && best.is_none_or(|(_, a)| area > a) {
        best = Some((at, area));
      }
    }
    i = at + 3;
  }
  best.map(|(at, _)| &src[at..])
}

/// Creation time and frame size from an MP4 / MOV / 3GP header ('mvhd' and 'tkhd' boxes).
/// Returns (naive-local-free UTC seconds, width, height).
pub fn video_info(head: &[u8]) -> (Option<i64>, i64, i64) {
  const MAC_EPOCH: i64 = 2_082_844_800; // seconds from 1904-01-01 to 1970-01-01
  let find = |tag: &[u8], from: usize| head[from.min(head.len())..].windows(4).position(|w| w == tag).map(|p| p + from);
  let be32 = |at: usize| head.get(at..at + 4).map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as u64);
  let be64 = |at: usize| head.get(at..at + 8).map(|b| u64::from_be_bytes(b.try_into().unwrap()));
  let mut taken = None;
  if let Some(p) = find(b"mvhd", 0) {
    let version = head.get(p + 4).copied().unwrap_or(0);
    let t = if version == 1 { be64(p + 8) } else { be32(p + 8) };
    if let Some(t) = t.filter(|&t| t as i64 > MAC_EPOCH) {
      taken = Some(t as i64 - MAC_EPOCH);
    }
  }
  // The first track header with a frame size is the video track (audio tracks have 0 x 0).
  let (mut w, mut h) = (0, 0);
  let mut from = 0;
  while let Some(p) = find(b"tkhd", from) {
    let version = head.get(p + 4).copied().unwrap_or(0);
    let dims = if version == 1 { p + 4 + 88 } else { p + 4 + 76 };
    if let (Some(fw), Some(fh)) = (be32(dims), be32(dims + 4)) {
      if fw > 0 && fh > 0 {
        w = (fw >> 16) as i64;
        h = (fh >> 16) as i64;
        break;
      }
    }
    from = p + 4;
  }
  (taken, w, h)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn file_types_switch_formats_on_and_off() {
    configure(&FileTypes::default());
    for f in ["a.JPG", "b.heic", "c.CR2", "d.nef", "e.dng", "f.psd", "g.tga", "h.mp4", "i.MOV", "j.avif", "k.mkv"] {
      assert!(is_media(Path::new(f)), "{f}");
    }
    assert!(!is_media(Path::new("notes.txt")) && !is_media(Path::new("x.jpg.crdownload")));
    configure(&FileTypes { raw: false, videos: false, ..FileTypes::default() });
    assert!(!is_media(Path::new("c.CR2")) && !is_media(Path::new("h.mp4")));
    assert!(is_media(Path::new("a.jpg")) && is_media(Path::new("b.heic")));
    configure(&FileTypes::default());
    assert_eq!(kind("x/IMG.CR3"), Kind::Raw);
    assert_eq!(kind("x/IMG.HEIC"), Kind::System);
    assert_eq!(kind("x/clip.mov"), Kind::Video);
    assert_eq!(kind("x/a.tga"), Kind::Image);
  }

  #[test]
  fn finds_the_largest_embedded_jpeg() {
    let jpeg = |w: u32, h: u32| {
      let img = image::RgbImage::new(w, h);
      let mut out = Vec::new();
      image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 70).encode_image(&img).unwrap();
      out
    };
    // A fake RAW: header bytes, a small thumbnail, sensor data, then the big preview.
    let mut raw = b"II*\0fake raw header".to_vec();
    raw.extend(jpeg(160, 120));
    raw.extend(vec![0x55; 5000]);
    let big = jpeg(1200, 800);
    raw.extend(&big);
    let preview = raw_preview(&raw).expect("preview found");
    let size = imagesize::blob_size(preview).unwrap();
    assert_eq!((size.width, size.height), (1200, 800));
  }

  #[test]
  fn reads_mp4_creation_time_and_size() {
    // Minimal 'mvhd' (version 0, created 2020-01-01) and a video 'tkhd' of 1920 x 1080.
    let created: u32 = (1_577_836_800i64 + 2_082_844_800) as u32;
    let mut head = b"....ftypisom....moov....mvhd".to_vec();
    head.extend([0, 0, 0, 0]); // version + flags
    head.extend(created.to_be_bytes());
    head.extend(vec![0; 80]);
    head.extend(b"....tkhd");
    head.extend([0, 0, 0, 7]);
    head.extend(vec![0; 72]);
    head.extend((1920u32 << 16).to_be_bytes());
    head.extend((1080u32 << 16).to_be_bytes());
    let (taken, w, h) = video_info(&head);
    assert_eq!(taken, Some(1_577_836_800));
    assert_eq!((w, h), (1920, 1080));
  }
}
