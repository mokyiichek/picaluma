//! People: face detection and recognition, entirely on this computer. Nothing is uploaded.
//!
//! - Detection: YuNet (OpenCV Zoo, MIT licence), 640×640 input.
//! - Recognition: SFace (OpenCV Zoo, Apache-2.0): a 128-number signature per face, compared by
//!   cosine similarity.
//!
//! Both run on the CPU through tract, a pure-Rust ONNX runtime, so every platform and
//! architecture Picaluma ships for gets the same results with no native libraries.

use image::{imageops, RgbImage};
use tract_onnx::prelude::*;

static YUNET: &[u8] = include_bytes!("../models/face_detection_yunet_2023mar.onnx");
static SFACE: &[u8] = include_bytes!("../models/face_recognition_sface_2021dec.onnx");

const DET: usize = 640;
const SCORE_MIN: f32 = 0.82;
const NMS_IOU: f32 = 0.3;
/// Faces smaller than this (pixels, in the analysed image) are too blurry to recognise.
const MIN_FACE: f32 = 24.0;

type Plan = TypedRunnableModel<TypedModel>;

/// A face, as fractions of the upright picture, with its signature.
#[derive(Clone, Debug)]
pub struct Face {
  pub x: f32,
  pub y: f32,
  pub w: f32,
  pub h: f32,
  pub score: f32,
  pub emb: Vec<f32>,
}

pub struct Engine {
  det: Plan,
  rec: Plan,
}

impl Engine {
  pub fn load() -> Result<Self, String> {
    let load = |bytes: &[u8], shape: [usize; 4]| -> TractResult<Plan> {
      tract_onnx::onnx()
        .model_for_read(&mut std::io::Cursor::new(bytes))?
        .with_input_fact(0, f32::fact(shape).into())?
        .into_optimized()?
        .into_runnable()
    };
    Ok(Engine {
      det: load(YUNET, [1, 3, DET, DET]).map_err(|e| format!("face detector: {e}"))?,
      rec: load(SFACE, [1, 3, 112, 112]).map_err(|e| format!("face recogniser: {e}"))?,
    })
  }

  /// Every face in an upright picture (ideally 1000–1600 pixels on its long side).
  pub fn analyze(&self, img: &RgbImage) -> Result<Vec<Face>, String> {
    let (w, h) = img.dimensions();
    if w < 32 || h < 32 {
      return Ok(Vec::new());
    }
    let scale = DET as f32 / w.max(h) as f32;
    let (sw, sh) = (((w as f32 * scale).round() as u32).max(1), ((h as f32 * scale).round() as u32).max(1));
    let small = imageops::resize(img, sw, sh, imageops::FilterType::Triangle);
    // BGR, 0–255, zero padded to 640×640.
    let mut input = tract_ndarray::Array4::<f32>::zeros((1, 3, DET, DET));
    for (x, y, p) in small.enumerate_pixels() {
      let (x, y) = (x as usize, y as usize);
      input[[0, 0, y, x]] = p[2] as f32;
      input[[0, 1, y, x]] = p[1] as f32;
      input[[0, 2, y, x]] = p[0] as f32;
    }
    let out = self.det.run(tvec!(Tensor::from(input).into())).map_err(|e| e.to_string())?;
    let mut found = decode(&out).map_err(|e| e.to_string())?;
    found = nms(found);
    let mut faces = Vec::new();
    for d in found {
      // Back to the analysed picture's pixels.
      let (bx, by, bw, bh) = (d.rect[0] / scale, d.rect[1] / scale, d.rect[2] / scale, d.rect[3] / scale);
      if bw < MIN_FACE || bh < MIN_FACE {
        continue;
      }
      let marks: Vec<(f32, f32)> = d.marks.iter().map(|&(x, y)| (x / scale, y / scale)).collect();
      let emb = self.embed(img, &marks)?;
      let (fw, fh) = (w as f32, h as f32);
      let x0 = bx.max(0.0);
      let y0 = by.max(0.0);
      faces.push(Face {
        x: x0 / fw,
        y: y0 / fh,
        w: ((bx + bw).min(fw) - x0) / fw,
        h: ((by + bh).min(fh) - y0) / fh,
        score: d.score,
        emb,
      });
    }
    Ok(faces)
  }

  /// Signature of the face whose five landmarks (eyes, nose, mouth corners) are given.
  fn embed(&self, img: &RgbImage, marks: &[(f32, f32)]) -> Result<Vec<f32>, String> {
    let aligned = align(img, marks);
    let mut input = tract_ndarray::Array4::<f32>::zeros((1, 3, 112, 112));
    for (x, y, p) in aligned.enumerate_pixels() {
      let (x, y) = (x as usize, y as usize);
      input[[0, 0, y, x]] = p[0] as f32;
      input[[0, 1, y, x]] = p[1] as f32;
      input[[0, 2, y, x]] = p[2] as f32;
    }
    let out = self.rec.run(tvec!(Tensor::from(input).into())).map_err(|e| e.to_string())?;
    let v = out[0].as_slice::<f32>().map_err(|e| e.to_string())?;
    Ok(normalize(v))
  }
}

struct Detection {
  rect: [f32; 4],
  marks: [(f32, f32); 5],
  score: f32,
}

/// YuNet's outputs: scores, objectness, boxes and landmarks for strides 8, 16 and 32.
fn decode(out: &[TValue]) -> TractResult<Vec<Detection>> {
  let mut found = Vec::new();
  for (i, stride) in [8usize, 16, 32].into_iter().enumerate() {
    let cols = DET / stride;
    let cls = out[i].as_slice::<f32>()?;
    let obj = out[i + 3].as_slice::<f32>()?;
    let bbox = out[i + 6].as_slice::<f32>()?;
    let kps = out[i + 9].as_slice::<f32>()?;
    let s = stride as f32;
    for idx in 0..cls.len().min(obj.len()) {
      let score = (cls[idx].clamp(0.0, 1.0) * obj[idx].clamp(0.0, 1.0)).sqrt();
      if score < SCORE_MIN {
        continue;
      }
      let (r, c) = ((idx / cols) as f32, (idx % cols) as f32);
      let cx = (c + bbox[idx * 4]) * s;
      let cy = (r + bbox[idx * 4 + 1]) * s;
      let w = bbox[idx * 4 + 2].exp() * s;
      let h = bbox[idx * 4 + 3].exp() * s;
      let mut marks = [(0.0, 0.0); 5];
      for (n, m) in marks.iter_mut().enumerate() {
        *m = ((kps[idx * 10 + 2 * n] + c) * s, (kps[idx * 10 + 2 * n + 1] + r) * s);
      }
      found.push(Detection { rect: [cx - w / 2.0, cy - h / 2.0, w, h], marks, score });
    }
  }
  Ok(found)
}

fn iou(a: &[f32; 4], b: &[f32; 4]) -> f32 {
  let x0 = a[0].max(b[0]);
  let y0 = a[1].max(b[1]);
  let x1 = (a[0] + a[2]).min(b[0] + b[2]);
  let y1 = (a[1] + a[3]).min(b[1] + b[3]);
  let inter = (x1 - x0).max(0.0) * (y1 - y0).max(0.0);
  let union = a[2] * a[3] + b[2] * b[3] - inter;
  if union <= 0.0 {
    0.0
  } else {
    inter / union
  }
}

/// Overlap of two rectangles given as [x, y, w, h] (any units).
pub fn overlap(a: [f32; 4], b: [f32; 4]) -> f32 {
  iou(&a, &b)
}

fn nms(mut found: Vec<Detection>) -> Vec<Detection> {
  found.sort_by(|a, b| b.score.total_cmp(&a.score));
  let mut keep: Vec<Detection> = Vec::new();
  for d in found {
    if keep.iter().all(|k| iou(&k.rect, &d.rect) < NMS_IOU) {
      keep.push(d);
    }
  }
  keep
}

/// The standard 112×112 face layout the recogniser was trained on.
const TEMPLATE: [(f32, f32); 5] = [(38.2946, 51.6963), (73.5318, 51.5014), (56.0252, 71.7366), (41.5493, 92.3655), (70.7299, 92.2041)];

/// Rotate, scale and move the face so its landmarks sit on the template (least-squares
/// similarity transform), sampling the source bilinearly.
fn align(img: &RgbImage, marks: &[(f32, f32)]) -> RgbImage {
  let n = marks.len().min(5) as f32;
  let (msx, msy) = marks.iter().fold((0.0, 0.0), |a, p| (a.0 + p.0 / n, a.1 + p.1 / n));
  let (mdx, mdy) = TEMPLATE.iter().fold((0.0, 0.0), |a, p| (a.0 + p.0 / n, a.1 + p.1 / n));
  let (mut num_a, mut num_b, mut den) = (0.0f32, 0.0f32, 0.0f32);
  for (s, d) in marks.iter().zip(TEMPLATE.iter()) {
    let (sx, sy) = (s.0 - msx, s.1 - msy);
    let (dx, dy) = (d.0 - mdx, d.1 - mdy);
    num_a += sx * dx + sy * dy;
    num_b += sx * dy - sy * dx;
    den += sx * sx + sy * sy;
  }
  let (a, b) = if den > 0.0 { (num_a / den, num_b / den) } else { (1.0, 0.0) };
  // dst = [a -b; b a]·src + t
  let tx = mdx - (a * msx - b * msy);
  let ty = mdy - (b * msx + a * msy);
  let k = a * a + b * b;
  let (iw, ih) = img.dimensions();
  let mut out = RgbImage::new(112, 112);
  for v in 0..112u32 {
    for u in 0..112u32 {
      let (px, py) = (u as f32 - tx, v as f32 - ty);
      let sx = (a * px + b * py) / k;
      let sy = (-b * px + a * py) / k;
      out.put_pixel(u, v, sample(img, sx, sy, iw, ih));
    }
  }
  out
}

fn sample(img: &RgbImage, x: f32, y: f32, w: u32, h: u32) -> image::Rgb<u8> {
  if x < 0.0 || y < 0.0 || x > (w - 1) as f32 || y > (h - 1) as f32 {
    return image::Rgb([0, 0, 0]);
  }
  let (x0, y0) = (x.floor() as u32, y.floor() as u32);
  let (x1, y1) = ((x0 + 1).min(w - 1), (y0 + 1).min(h - 1));
  let (fx, fy) = (x - x0 as f32, y - y0 as f32);
  let p = |xx, yy| img.get_pixel(xx, yy).0;
  let (p00, p10, p01, p11) = (p(x0, y0), p(x1, y0), p(x0, y1), p(x1, y1));
  let mut c = [0u8; 3];
  for i in 0..3 {
    let top = p00[i] as f32 * (1.0 - fx) + p10[i] as f32 * fx;
    let bottom = p01[i] as f32 * (1.0 - fx) + p11[i] as f32 * fx;
    c[i] = (top * (1.0 - fy) + bottom * fy).round() as u8;
  }
  image::Rgb(c)
}

/// The long side pictures are analysed at: enough for faces across a group photo.
pub const ANALYSE_EDGE: u32 = 1280;

/// The upright picture at about `edge` pixels (JPEGs decoded with DCT scaling; RAW from its
/// preview; HEIC and friends from the system).
pub fn load_upright(path: &str, edge: u32) -> Result<RgbImage, String> {
  use crate::formats::{self, Kind};
  let img = match formats::kind(path) {
    Kind::Video => return Err("movie".into()),
    Kind::System => crate::sysimg::system_image(path, edge)?,
    kind => {
      let src = std::fs::read(path).map_err(|e| e.to_string())?;
      let orientation = crate::thumbs::exif_orientation(&src).unwrap_or(1);
      let bytes: &[u8] = if kind == Kind::Raw { formats::raw_preview(&src).ok_or("no RAW preview")? } else { &src };
      let img = if bytes.starts_with(&[0xFF, 0xD8]) { jpeg_scaled(bytes, edge)? } else { image::load_from_memory(bytes).map_err(|e| e.to_string())? };
      crate::thumbs::apply_orientation(img, orientation)
    }
  };
  let img = if img.width().max(img.height()) > edge * 3 / 2 { img.resize(edge, edge, imageops::FilterType::Triangle) } else { img };
  Ok(img.to_rgb8())
}

fn jpeg_scaled(src: &[u8], edge: u32) -> Result<image::DynamicImage, String> {
  let mut dec = jpeg_decoder::Decoder::new(std::io::Cursor::new(src));
  dec.read_info().map_err(|e| e.to_string())?;
  let (w, h) = dec.scale(edge as u16, edge as u16).map_err(|e| e.to_string())?;
  let pixels = dec.decode().map_err(|e| e.to_string())?;
  let info = dec.info().ok_or("no jpeg info")?;
  let (w, h) = (w as u32, h as u32);
  match info.pixel_format {
    jpeg_decoder::PixelFormat::RGB24 => RgbImage::from_raw(w, h, pixels).map(image::DynamicImage::ImageRgb8).ok_or_else(|| "bad jpeg".into()),
    jpeg_decoder::PixelFormat::L8 => image::GrayImage::from_raw(w, h, pixels).map(image::DynamicImage::ImageLuma8).ok_or_else(|| "bad jpeg".into()),
    _ => image::load_from_memory(src).map_err(|e| e.to_string()),
  }
}

pub fn normalize(v: &[f32]) -> Vec<f32> {
  let n = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-6);
  v.iter().map(|x| x / n).collect()
}

/// Cosine similarity of two normalised signatures (1 = identical).
pub fn similarity(a: &[f32], b: &[f32]) -> f32 {
  a.iter().zip(b).map(|(x, y)| x * y).sum()
}

pub fn to_blob(v: &[f32]) -> Vec<u8> {
  v.iter().flat_map(|x| x.to_le_bytes()).collect()
}

pub fn from_blob(b: &[u8]) -> Vec<f32> {
  b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn finds_no_faces_in_a_plain_picture() {
    let engine = Engine::load().unwrap();
    let img = RgbImage::from_pixel(800, 600, image::Rgb([120, 160, 200]));
    assert!(engine.analyze(&img).unwrap().is_empty());
  }

  /// Accuracy check against Picasa's own name tags (local only, never committed):
  /// PICALUMA_FACE_EVAL="D:/Photos/Party;D:/Photos/Trip" cargo test eval_against_picasa -- --ignored --nocapture
  #[test]
  #[ignore]
  fn eval_against_picasa() {
    let dirs = std::env::var("PICALUMA_FACE_EVAL").unwrap_or_default();
    let engine = Engine::load().unwrap();
    let mut tagged: Vec<(String, Vec<f32>)> = Vec::new();
    let (mut picasa_faces, mut matched, mut detected, mut photos) = (0, 0, 0, 0);
    let t0 = std::time::Instant::now();
    for dir in dirs.split(';').filter(|d| !d.is_empty()) {
      let ini = crate::picasa::read_ini(std::path::Path::new(dir));
      for (file, rects) in &ini.faces {
        let path = std::path::Path::new(dir).join(file).to_string_lossy().into_owned();
        let t = std::time::Instant::now();
        let Ok(img) = load_upright(&path, ANALYSE_EDGE) else { continue };
        let t_load = t.elapsed();
        photos += 1;
        let t = std::time::Instant::now();
        let found = engine.analyze(&img).unwrap();
        if photos <= 12 {
          println!("load {:?} analyse {:?} faces {} ({}x{})", t_load, t.elapsed(), found.len(), img.width(), img.height());
        }
        detected += found.len();
        for (rect, contact) in rects {
          picasa_faces += 1;
          let best = found.iter().map(|f| (overlap([f.x, f.y, f.w, f.h], *rect), f)).max_by(|a, b| a.0.total_cmp(&b.0));
          if let Some((o, f)) = best {
            if o > 0.25 {
              matched += 1;
              tagged.push((contact.clone(), f.emb.clone()));
            }
          }
        }
      }
    }
    println!("photos {photos}, picasa faces {picasa_faces}, matched {matched}, detected {detected}, {:.0} ms/photo", t0.elapsed().as_millis() as f64 / photos.max(1) as f64);
    let (mut same, mut diff) = (Vec::new(), Vec::new());
    for i in 0..tagged.len() {
      for j in i + 1..tagged.len() {
        let s = similarity(&tagged[i].1, &tagged[j].1);
        if tagged[i].0 == tagged[j].0 { same.push(s) } else { diff.push(s) }
      }
    }
    for t in [0.30f32, 0.35, 0.40, 0.45, 0.50, 0.55] {
      let tp = same.iter().filter(|s| **s >= t).count() as f32 / same.len().max(1) as f32;
      let fp = diff.iter().filter(|s| **s >= t).count() as f32 / diff.len().max(1) as f32;
      println!("threshold {t:.2}: same-person pairs found {:.1}%, different-person pairs wrongly matched {:.2}%", tp * 100.0, fp * 100.0);
    }
  }

  #[test]
  fn alignment_maps_the_template_onto_itself() {
    let mut img = RgbImage::new(112, 112);
    for (x, y, p) in img.enumerate_pixels_mut() {
      *p = image::Rgb([x as u8, y as u8, 0]);
    }
    let out = align(&img, &TEMPLATE);
    assert_eq!(out.get_pixel(30, 40).0[..2], [30, 40]);
  }
}

