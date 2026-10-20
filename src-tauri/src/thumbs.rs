use std::collections::HashSet;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Condvar, Mutex};

use image::{imageops, DynamicImage, ImageBuffer, Luma, Rgb};
use rayon::prelude::*;
use tauri::http::{Request, Response};
use tauri::{AppHandle, Manager, UriSchemeResponder};

use crate::formats::{self, Kind};
use crate::sysimg;
use crate::AppState;

/// Longest edge of cached thumbnails. Large enough for the biggest grid slider setting.
const THUMB_EDGE: u32 = 360;
const THUMB_QUALITY: u8 = 85;

struct PhotoRef {
  path: String,
  mtime: i64,
  orientation: i64,
}

type Job = Box<dyn FnOnce() + Send>;

/// LIFO work queue for thumbnail decodes: the most recently requested thumbnails (the ones
/// on screen right now) are built first, so fast scrolling and slider changes stay snappy.
pub struct ThumbQueue {
  jobs: Mutex<Vec<Job>>,
  ready: Condvar,
}

impl ThumbQueue {
  pub fn start(workers: usize) -> Arc<Self> {
    let q = Arc::new(ThumbQueue { jobs: Mutex::new(Vec::new()), ready: Condvar::new() });
    for i in 0..workers {
      let q = q.clone();
      std::thread::Builder::new()
        .name(format!("thumb-{i}"))
        .spawn(move || loop {
          let job = {
            let mut jobs = q.jobs.lock().unwrap();
            while jobs.is_empty() {
              jobs = q.ready.wait(jobs).unwrap();
            }
            jobs.pop().unwrap()
          };
          job();
        })
        .expect("spawn thumbnail worker");
    }
    q
  }

  pub fn push(&self, job: impl FnOnce() + Send + 'static) {
    self.jobs.lock().unwrap().push(Box::new(job));
    self.ready.notify_one();
  }

  pub fn pending(&self) -> usize {
    self.jobs.lock().unwrap().len()
  }
}

/// Cache hits answer immediately; misses are queued for a decode.
pub fn handle_thumb(app: AppHandle, req: Request<Vec<u8>>, responder: UriSchemeResponder) {
  let Some(id) = parse_id(&req) else { return responder.respond(not_found()) };
  let Some(photo) = lookup(&app, id) else { return responder.respond(not_found()) };
  let state = app.state::<AppState>();
  let cache = cache_path(&state.thumb_dir, &photo.path, photo.mtime);
  if let Ok(bytes) = std::fs::read(&cache) {
    return responder.respond(image_response(bytes, "image/jpeg"));
  }
  state.thumbs.push(move || {
    let response = match ensure_thumb(&cache, &photo) {
      Ok(bytes) => image_response(bytes, "image/jpeg"),
      Err(e) => {
        log::warn!("thumb {}: {e}", photo.path);
        not_found()
      }
    };
    responder.respond(response);
  });
}

/// Files whose thumbnail couldn't be made this session (unsupported codec, damaged file), so
/// the grid doesn't ask for them again and again.
static FAILED: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);

fn ensure_thumb(cache: &Path, photo: &PhotoRef) -> Result<Vec<u8>, String> {
  if let Ok(bytes) = std::fs::read(cache) {
    return Ok(bytes);
  }
  if FAILED.lock().unwrap().as_ref().is_some_and(|f| f.contains(cache)) {
    return Err("no thumbnail (failed earlier)".into());
  }
  match make_thumb(&photo.path, photo.orientation) {
    Ok(bytes) => {
      store(cache, &bytes);
      Ok(bytes)
    }
    Err(e) => {
      FAILED.lock().unwrap().get_or_insert_with(HashSet::new).insert(cache.to_path_buf());
      Err(e)
    }
  }
}

/// A thumbnail for any supported file: pictures decoded here, RAW from its embedded preview,
/// HEIC/AVIF/PSD and video frames from the operating system.
fn make_thumb(path: &str, orientation_hint: i64) -> Result<Vec<u8>, String> {
  match formats::kind(path) {
    Kind::Video => encode_thumb(sysimg::video_frame(path, THUMB_EDGE * 2)?, 1),
    Kind::System => encode_thumb(sysimg::system_image(path, THUMB_EDGE * 2)?, 1),
    Kind::Raw => {
      let src = std::fs::read(path).map_err(|e| e.to_string())?;
      match formats::raw_preview(&src) {
        Some(jpeg) => {
          let orientation = exif_orientation(&src).unwrap_or(orientation_hint);
          encode_thumb(decode_scaled(jpeg, "preview.jpg")?, orientation)
        }
        None => encode_thumb(sysimg::system_image(path, THUMB_EDGE * 2)?, 1),
      }
    }
    Kind::Image => {
      let src = std::fs::read(path).map_err(|e| e.to_string())?;
      // Orientation comes from the file itself: indexing may not have recorded it yet.
      let orientation = exif_orientation(&src).unwrap_or(orientation_hint);
      build_thumb(&src, path, orientation)
    }
  }
}

/// Writes a thumbnail from bytes already in memory (the macOS HEIC test).
#[cfg(all(test, target_os = "macos"))]
pub fn write_thumb_from_bytes(dir: &Path, mtime: i64, path: &str, src: &[u8], orientation: i64) {
  let cache = cache_path(dir, path, mtime);
  if cache.exists() {
    return;
  }
  match build_thumb(src, path, orientation) {
    Ok(bytes) => store(&cache, &bytes),
    Err(e) => log::warn!("thumb {path}: {e}"),
  }
}

fn store(cache: &Path, bytes: &[u8]) {
  if let Some(dir) = cache.parent() {
    let _ = std::fs::create_dir_all(dir);
  }
  let _ = std::fs::write(cache, bytes);
}

pub(crate) fn exif_orientation(src: &[u8]) -> Option<i64> {
  let ex = exif::Reader::new().read_from_container(&mut Cursor::new(src)).ok()?;
  ex.get_field(exif::Tag::Orientation, exif::In::PRIMARY)?.value.get_uint(0).map(|v| v as i64)
}

/// Background warmer: after a scan, pre-build every missing thumbnail (newest folders first)
/// on two low-priority threads, backing off whenever the UI is waiting on the queue. Online-only
/// cloud files are left alone; their thumbnails are made when they scroll into view.
pub fn spawn_warmer(app: AppHandle) {
  let state = app.state::<AppState>();
  if state.warming.swap(true, Ordering::SeqCst) {
    return;
  }
  let db = state.db.clone();
  let dir = state.thumb_dir.clone();
  let queue = state.thumbs.clone();
  let flag = state.warming.clone();
  std::thread::spawn(move || {
    prune_cache(&db, &dir);
    let photos: Vec<(i64, PhotoRef)> = {
      let conn = db.lock().unwrap();
      let mut stmt = conn
        .prepare(
          "SELECT p.id, p.path, p.mtime, p.orientation FROM photos p JOIN folders f ON f.id = p.folder_id
           WHERE p.cloud = 0
           ORDER BY f.updated DESC, p.folder_id, COALESCE(p.taken, p.mtime), p.name",
        )
        .unwrap();
      let rows = stmt
        .query_map([], |r| Ok((r.get(0)?, PhotoRef { path: r.get(1)?, mtime: r.get(2)?, orientation: r.get(3)? })))
        .unwrap();
      rows.filter_map(Result::ok).collect()
    };
    let todo: Vec<_> = photos.into_iter().filter(|(_, p)| !cache_path(&dir, &p.path, p.mtime).exists()).collect();
    if !todo.is_empty() {
      log::info!("warming {} thumbnails", todo.len());
      let started = std::time::Instant::now();
      let pool = rayon::ThreadPoolBuilder::new().num_threads(2).thread_name(|i| format!("warm-{i}")).build().unwrap();
      pool.install(|| {
        todo.par_iter().for_each(|(_, p)| {
          while queue.pending() > 0 {
            std::thread::sleep(std::time::Duration::from_millis(40));
          }
          let _ = ensure_thumb(&cache_path(&dir, &p.path, p.mtime), p);
        })
      });
      log::info!("warmed {} thumbnails in {:?}", todo.len(), started.elapsed());
    }
    flag.store(false, Ordering::SeqCst);
  });
}

/// Deletes cached thumbnails that no picture in the library uses any more (folders removed,
/// files changed since, older versions' cache layout), so the cache doesn't grow forever.
fn prune_cache(db: &Arc<Mutex<rusqlite::Connection>>, dir: &Path) {
  let started = std::time::Instant::now();
  let keep: HashSet<String> = {
    let conn = db.lock().unwrap();
    let Ok(mut stmt) = conn.prepare("SELECT path, mtime FROM photos") else { return };
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)));
    let Ok(rows) = rows else { return };
    rows
      .filter_map(Result::ok)
      .filter_map(|(path, mtime)| cache_path(dir, &path, mtime).file_name().map(|n| n.to_string_lossy().into_owned()))
      .collect()
  };
  if keep.is_empty() {
    return; // never wipe the cache because of an empty or unreadable library
  }
  let (mut removed, mut bytes) = (0u64, 0u64);
  let Ok(entries) = std::fs::read_dir(dir) else { return };
  for entry in entries.flatten() {
    let name = entry.file_name().to_string_lossy().into_owned();
    if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
      continue;
    }
    if name.len() == 3 && name.bytes().all(|b| b.is_ascii_digit()) {
      // Cache layout of Picaluma 0.1–0.2.
      if std::fs::remove_dir_all(entry.path()).is_ok() {
        removed += 1;
      }
    } else if name.len() == 2 && name.bytes().all(|b| b.is_ascii_hexdigit()) {
      let Ok(files) = std::fs::read_dir(entry.path()) else { continue };
      for f in files.flatten() {
        let fname = f.file_name().to_string_lossy().into_owned();
        if fname.ends_with(".jpg") && !keep.contains(&fname) {
          let size = f.metadata().map(|m| m.len()).unwrap_or(0);
          if std::fs::remove_file(f.path()).is_ok() {
            removed += 1;
            bytes += size;
          }
        }
      }
    }
  }
  if removed > 0 {
    log::info!("thumbnail cache: removed {removed} unused entries ({} MB) in {:?}", bytes / 1_048_576, started.elapsed());
  }
}

pub fn handle_photo(app: &AppHandle, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
  let Some(id) = parse_id(req) else { return not_found() };
  let Some(photo) = lookup(app, id) else { return not_found() };
  if formats::is_video(&photo.path) {
    return video_response(&photo.path, req);
  }
  if needs_display_conversion(&photo.path) {
    let dir = app.state::<AppState>().thumb_dir.clone();
    return match display_jpeg(&dir, &photo.path, photo.mtime) {
      Ok(bytes) => image_response(bytes, "image/jpeg"),
      Err(e) => {
        log::warn!("display {}: {e}", photo.path);
        not_found()
      }
    };
  }
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

/// Cache files are keyed by the photo's path (not its database id), so a rebuilt library can
/// never pick up another photo's thumbnail.
fn cache_path(dir: &Path, path: &str, mtime: i64) -> PathBuf {
  let h = fnv1a(path.to_lowercase().as_bytes());
  dir.join(format!("{:02x}", h & 0xff)).join(format!("{h:016x}_{mtime}.jpg"))
}

fn fnv1a(bytes: &[u8]) -> u64 {
  bytes.iter().fold(0xcbf2_9ce4_8422_2325u64, |h, b| (h ^ *b as u64).wrapping_mul(0x0100_0000_01b3))
}

fn build_thumb(src: &[u8], path: &str, orientation: i64) -> Result<Vec<u8>, String> {
  if formats::kind(path) == Kind::System {
    return encode_thumb(sysimg::system_image(path, THUMB_EDGE * 2)?, 1);
  }
  let img = decode_scaled(src, path)?;
  encode_thumb(img, orientation)
}

fn encode_thumb(img: DynamicImage, orientation: i64) -> Result<Vec<u8>, String> {
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
fn decode_scaled(src: &[u8], path: &str) -> Result<DynamicImage, String> {
  let ext = Path::new(path).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
  if matches!(ext.as_str(), "jpg" | "jpeg" | "jpe") || src.starts_with(&[0xFF, 0xD8]) {
    if let Ok(img) = decode_jpeg_scaled(src) {
      return Ok(img);
    }
  }
  image::load_from_memory(src).map_err(|e| e.to_string())
}

fn decode_jpeg_scaled(src: &[u8]) -> Result<DynamicImage, String> {
  let mut dec = jpeg_decoder::Decoder::new(Cursor::new(src));
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

pub(crate) fn apply_orientation(img: DynamicImage, orientation: i64) -> DynamicImage {
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

/// Formats the webview can't display natively: RAW, HEIC/AVIF/PSD and TGA everywhere, TIFF in
/// WebView2 (Windows) and WebKitGTK.
fn needs_display_conversion(path: &str) -> bool {
  let lower = path.to_lowercase();
  matches!(formats::kind(path), Kind::Raw | Kind::System)
    || lower.ends_with(".tga")
    || (!cfg!(target_os = "macos") && (lower.ends_with(".tif") || lower.ends_with(".tiff")))
}

/// Largest edge of converted full-size photos (HEIC/TIFF shown in the editor and slideshow).
const DISPLAY_EDGE: u32 = 3200;

/// A cached, webview-friendly JPEG for a photo the webview can't decode itself.
fn display_jpeg(thumb_dir: &Path, path: &str, mtime: i64) -> Result<Vec<u8>, String> {
  let cache = thumb_dir.join("full").join(cache_path(Path::new(""), path, mtime));
  if let Ok(b) = std::fs::read(&cache) {
    return Ok(b);
  }
  let bytes = if formats::kind(path) != Kind::Image {
    let img = match formats::kind(path) {
      Kind::Raw => {
        let src = std::fs::read(path).map_err(|e| e.to_string())?;
        match formats::raw_preview(&src) {
          Some(jpeg) => apply_orientation(image::load_from_memory(jpeg).map_err(|e| e.to_string())?, exif_orientation(&src).unwrap_or(1)),
          None => sysimg::system_image(path, DISPLAY_EDGE)?,
        }
      }
      _ => sysimg::system_image(path, DISPLAY_EDGE)?,
    };
    let img = if img.width().max(img.height()) > DISPLAY_EDGE { img.resize(DISPLAY_EDGE, DISPLAY_EDGE, imageops::FilterType::Triangle) } else { img };
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 90).encode_image(&img.to_rgb8()).map_err(|e| e.to_string())?;
    out
  } else {
    let img = image::open(path).map_err(|e| e.to_string())?;
    let img = if img.width().max(img.height()) > DISPLAY_EDGE { img.resize(DISPLAY_EDGE, DISPLAY_EDGE, imageops::FilterType::Triangle) } else { img };
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 90).encode_image(&img.to_rgb8()).map_err(|e| e.to_string())?;
    out
  };
  store(&cache, &bytes);
  Ok(bytes)
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

/// Videos are streamed in pieces with HTTP range requests, so the player can start at once and
/// seek, and a 4 GB clip never has to be loaded into memory.
fn video_response(path: &str, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
  use std::io::{Read, Seek, SeekFrom};
  const CHUNK: u64 = 4 << 20;
  let Ok(mut file) = std::fs::File::open(path) else { return not_found() };
  let len = file.metadata().map(|m| m.len()).unwrap_or(0);
  if len == 0 {
    return not_found();
  }
  let range = req.headers().get("range").and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("bytes="));
  let (start, end) = match range.and_then(|r| r.split_once('-')) {
    Some((a, b)) => {
      let start = a.trim().parse::<u64>().unwrap_or(0).min(len - 1);
      let end = b.trim().parse::<u64>().ok().unwrap_or(len - 1).min(len - 1);
      (start, end.min(start + CHUNK - 1))
    }
    None => (0, (len - 1).min(CHUNK - 1)),
  };
  let mut buf = vec![0u8; (end - start + 1) as usize];
  if file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut buf).is_err() {
    return not_found();
  }
  Response::builder()
    .status(206)
    .header("Content-Type", video_mime(path))
    .header("Accept-Ranges", "bytes")
    .header("Content-Range", format!("bytes {start}-{end}/{len}"))
    .header("Content-Length", buf.len().to_string())
    .header("Access-Control-Allow-Origin", "*")
    .body(buf)
    .unwrap()
}

fn video_mime(path: &str) -> &'static str {
  match path.to_lowercase().rsplit('.').next().unwrap_or("") {
    "mov" | "qt" => "video/quicktime",
    "webm" => "video/webm",
    "mkv" => "video/x-matroska",
    "avi" => "video/x-msvideo",
    "wmv" | "asf" => "video/x-ms-wmv",
    "mpg" | "mpeg" | "m2v" | "mod" | "tod" => "video/mpeg",
    "3gp" => "video/3gpp",
    "3g2" => "video/3gpp2",
    "mts" | "m2ts" => "video/mp2t",
    "flv" => "video/x-flv",
    _ => "video/mp4",
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
