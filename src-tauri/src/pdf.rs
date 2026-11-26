//! PDF documents, drawn by Picaluma itself with hayro (pure Rust, nothing to install): the page
//! count and page sizes, and any page as a picture for thumbnails and the viewer.

use std::sync::{Arc, Mutex};

use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::Pdf;
use hayro::vello_cpu::color::palette::css::WHITE;
use hayro::{render, PixmapSettings, RenderCache, RenderSettings};
use image::{DynamicImage, RgbaImage};

/// The largest page picture made (longer edge, pixels).
pub const MAX_EDGE: u32 = 6000;

/// A document read: its path, a stamp of its size and time, and its bytes.
type Read = (String, u64, Arc<Vec<u8>>);
/// The last few documents read, so turning pages doesn't read the file again.
static RECENT: Mutex<Vec<Read>> = Mutex::new(Vec::new());
const RECENT_BYTES: usize = 96 << 20;

fn read(path: &str) -> Result<Arc<Vec<u8>>, String> {
  let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
  let stamp = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0) ^ meta.len();
  {
    let recent = RECENT.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((_, _, b)) = recent.iter().find(|(p, s, _)| p == path && *s == stamp) {
      return Ok(b.clone());
    }
  }
  let bytes = Arc::new(std::fs::read(path).map_err(|e| e.to_string())?);
  if bytes.len() > RECENT_BYTES / 2 {
    return Ok(bytes); // too big to keep around
  }
  let mut recent = RECENT.lock().unwrap_or_else(|e| e.into_inner());
  recent.retain(|(p, _, _)| p != path);
  recent.insert(0, (path.to_string(), stamp, bytes.clone()));
  let mut total = 0;
  recent.retain(|(_, _, b)| {
    total += b.len();
    total <= RECENT_BYTES
  });
  recent.truncate(4);
  Ok(bytes)
}

fn open(path: &str) -> Result<Pdf, String> {
  Pdf::new(read(path)?).map_err(|e| format!("can't read this PDF ({e:?})"))
}

/// Each page's size in points (1/72 inch), as shown (rotated pages turned).
pub fn page_sizes(path: &str) -> Result<Vec<(f32, f32)>, String> {
  let pdf = open(path)?;
  Ok(pdf.pages().iter().map(|p| p.render_dimensions()).collect())
}

/// Page `index` (from 0) drawn on white to fit inside `edge` × `edge` pixels.
pub fn render_page(path: &str, index: usize, edge: u32) -> Result<DynamicImage, String> {
  let pdf = open(path)?;
  let pages = pdf.pages();
  let page = pages.get(index).ok_or("no such page")?;
  let (w, h) = page.render_dimensions();
  if w <= 0.0 || h <= 0.0 {
    return Err("empty page".into());
  }
  let edge = edge.clamp(16, MAX_EDGE) as f32;
  let scale = edge / w.max(h);
  let settings = PixmapSettings { x_scale: scale, y_scale: scale, bg_color: WHITE };
  let cache = RenderCache::new();
  let pix = render(page, &cache, &InterpreterSettings::default(), &RenderSettings::default(), &settings);
  let (pw, ph) = (pix.width() as u32, pix.height() as u32);
  // Drawn on white, so every pixel is opaque and premultiplied equals straight RGBA.
  let rgba = RgbaImage::from_raw(pw, ph, pix.data_as_u8_slice().to_vec()).ok_or("bad page size")?;
  Ok(DynamicImage::ImageRgb8(DynamicImage::ImageRgba8(rgba).to_rgb8()))
}

#[cfg(test)]
mod tests {
  use super::*;

  /// A one-page PDF with a filled square, written by hand.
  fn tiny_pdf() -> Vec<u8> {
    let content = b"0 0 1 rg 50 50 100 100 re f";
    let objs = [
      "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Contents 4 0 R >>".to_string(),
      format!("<< /Length {} >>\nstream\n{}\nendstream", content.len(), std::str::from_utf8(content).unwrap()),
    ];
    let mut out = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (i, o) in objs.iter().enumerate() {
      offsets.push(out.len());
      out.extend(format!("{} 0 obj\n{}\nendobj\n", i + 1, o).as_bytes());
    }
    let xref = out.len();
    out.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).as_bytes());
    for o in offsets {
      out.extend(format!("{o:010} 00000 n \n").as_bytes());
    }
    out.extend(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objs.len() + 1).as_bytes());
    out
  }

  #[test]
  fn reads_and_draws_a_page() {
    let dir = std::env::temp_dir().join(format!("picaluma-pdf-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("doc.pdf");
    std::fs::write(&path, tiny_pdf()).unwrap();
    let p = path.to_string_lossy();
    assert_eq!(page_sizes(&p).unwrap(), vec![(200.0, 300.0)]);
    let img = render_page(&p, 0, 300).unwrap().to_rgb8();
    assert_eq!((img.width(), img.height()), (200, 300));
    // White page, blue square from (50,50) to (150,150) in PDF space (y up).
    assert_eq!(img.get_pixel(5, 5).0, [255, 255, 255]);
    let c = img.get_pixel(100, 300 - 100).0;
    assert!(c[2] > 200 && c[0] < 40, "{c:?}");
    assert!(render_page(&p, 1, 300).is_err());
    let _ = std::fs::remove_dir_all(&dir);
  }
}
