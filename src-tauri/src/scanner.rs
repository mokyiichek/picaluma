use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use rayon::prelude::*;
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

use crate::db;
use crate::AppState;

const IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "jpe", "png", "gif", "bmp", "webp", "tif", "tiff"];

/// Directory names never worth descending into, even when a whole drive is watched.
const SKIP_DIRS: &[&str] = &[
  "$recycle.bin", "system volume information", "windows", "program files", "program files (x86)",
  "programdata", "appdata", "node_modules", "recovery", "msocache", "$windows.~bt", "$windows.~ws",
];

const EVENT_THROTTLE: Duration = Duration::from_millis(750);

#[derive(Clone, Serialize)]
pub struct ScanProgress {
  pub scanning: bool,
  pub folders_seen: u64,
  pub current: String,
}

struct FileInfo {
  path: PathBuf,
  name: String,
  size: i64,
  mtime: i64,
}

struct Meta {
  width: i64,
  height: i64,
  taken: Option<i64>,
  orientation: i64,
  make: String,
  model: String,
  has_gps: bool,
  exif: String,
}

pub fn spawn_rescan(app: AppHandle) {
  let state = app.state::<AppState>();
  if state.scanning.swap(true, Ordering::SeqCst) {
    return;
  }
  let db = state.db.clone();
  let flag = state.scanning.clone();
  std::thread::spawn(move || {
    let started = Instant::now();
    let (roots, excluded) = load_roots(&db);
    let mut progress = ScanProgress { scanning: true, folders_seen: 0, current: String::new() };
    let mut last_emit = Instant::now() - EVENT_THROTTLE;
    let mut seen_folders: Vec<String> = Vec::new();
    for root in &roots {
      scan_root(&app, &db, Path::new(root), &excluded, &mut progress, &mut last_emit, &mut seen_folders);
    }
    prune_missing_folders(&db, &roots, &excluded, &seen_folders);
    flag.store(false, Ordering::SeqCst);
    progress.scanning = false;
    progress.current.clear();
    let _ = app.emit("scan-progress", progress.clone());
    let _ = app.emit("library-changed", ());
    log::info!("scan finished: {} folders in {:?}", progress.folders_seen, started.elapsed());
    crate::thumbs::spawn_warmer(app.clone());
  });
}

pub fn is_scanning(app: &AppHandle) -> bool {
  app.state::<AppState>().scanning.load(Ordering::SeqCst)
}

fn load_roots(db: &Arc<Mutex<Connection>>) -> (Vec<String>, Vec<String>) {
  let conn = db.lock().unwrap();
  let mut stmt = conn.prepare("SELECT path, excluded FROM roots ORDER BY path").unwrap();
  let rows: Vec<(String, i64)> = stmt
    .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
    .unwrap()
    .filter_map(Result::ok)
    .collect();
  let roots = rows.iter().filter(|r| r.1 == 0).map(|r| r.0.clone()).collect();
  let excluded = rows.iter().filter(|r| r.1 != 0).map(|r| normalize(&r.0)).collect();
  (roots, excluded)
}

fn scan_root(
  app: &AppHandle,
  db: &Arc<Mutex<Connection>>,
  root: &Path,
  excluded: &[String],
  progress: &mut ScanProgress,
  last_emit: &mut Instant,
  seen_folders: &mut Vec<String>,
) {
  let walker = WalkDir::new(root).follow_links(false).into_iter().filter_entry(|e| {
    if !e.file_type().is_dir() {
      return false;
    }
    if e.depth() == 0 {
      return true;
    }
    let name = e.file_name().to_string_lossy().to_lowercase();
    if name.starts_with('.') || name.starts_with('$') || SKIP_DIRS.contains(&name.as_str()) {
      return false;
    }
    !is_excluded(e.path(), excluded)
  });

  for entry in walker.filter_map(Result::ok) {
    let dir = entry.path();
    progress.folders_seen += 1;
    match scan_dir(db, dir) {
      Ok(Some(changed)) => {
        seen_folders.push(dir.to_string_lossy().into_owned());
        if changed && last_emit.elapsed() >= EVENT_THROTTLE {
          *last_emit = Instant::now();
          progress.current = dir.to_string_lossy().into_owned();
          let _ = app.emit("scan-progress", progress.clone());
          let _ = app.emit("library-changed", ());
        }
      }
      Ok(None) => {}
      Err(e) => log::warn!("scan {}: {e}", dir.display()),
    }
  }
}

/// Index one directory. Returns Some(changed) when it holds pictures, None when it holds none.
fn scan_dir(db: &Arc<Mutex<Connection>>, dir: &Path) -> rusqlite::Result<Option<bool>> {
  let files = list_images(dir);
  let dir_str = dir.to_string_lossy().into_owned();

  if files.is_empty() {
    let conn = db.lock().unwrap();
    conn.execute("DELETE FROM folders WHERE path = ?1", [&dir_str])?;
    return Ok(None);
  }

  // Compare against what we already know so rescans only touch new or changed files.
  let known: HashMap<String, (i64, i64, i64)> = {
    let conn = db.lock().unwrap();
    let mut stmt = conn.prepare_cached(
      "SELECT p.path, p.id, p.size, p.mtime FROM photos p JOIN folders f ON f.id = p.folder_id WHERE f.path = ?1",
    )?;
    let rows = stmt.query_map([&dir_str], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?, r.get(3)?))))?;
    rows.filter_map(Result::ok).collect()
  };

  let changed: Vec<&FileInfo> = files
    .iter()
    .filter(|f| match known.get(&*f.path.to_string_lossy()) {
      Some((_, size, mtime)) => *size != f.size || *mtime != f.mtime,
      None => true,
    })
    .collect();
  let live: std::collections::HashSet<String> = files.iter().map(|f| f.path.to_string_lossy().into_owned()).collect();
  let removed: Vec<i64> = known.iter().filter(|(p, _)| !live.contains(*p)).map(|(_, v)| v.0).collect();

  if changed.is_empty() && removed.is_empty() {
    return Ok(Some(false));
  }

  // EXIF parsing is the slow part; do it in parallel without holding the DB lock.
  let metas: Vec<(&FileInfo, Meta)> = changed.par_iter().map(|f| (*f, read_meta(&f.path))).collect();

  let mut conn = db.lock().unwrap();
  let tx = conn.transaction()?;
  let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| dir_str.clone());
  tx.execute("INSERT OR IGNORE INTO folders(path, name) VALUES (?1, ?2)", params![dir_str, name])?;
  let folder_id: i64 = tx.query_row("SELECT id FROM folders WHERE path = ?1", [&dir_str], |r| r.get(0))?;

  for id in &removed {
    tx.execute("DELETE FROM photos_fts WHERE rowid = ?1", [id])?;
    tx.execute("DELETE FROM photos WHERE id = ?1", [id])?;
  }
  {
    let mut upsert = tx.prepare_cached(
      "INSERT INTO photos(folder_id, path, name, size, mtime, taken, width, height, orientation, make, model, has_gps, exif)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
       ON CONFLICT(path) DO UPDATE SET
         folder_id = excluded.folder_id, size = excluded.size, mtime = excluded.mtime, taken = excluded.taken,
         width = excluded.width, height = excluded.height, orientation = excluded.orientation,
         make = excluded.make, model = excluded.model, has_gps = excluded.has_gps, exif = excluded.exif
       RETURNING id",
    )?;
    for (f, m) in &metas {
      let id: i64 = upsert.query_row(
        params![
          folder_id,
          f.path.to_string_lossy(),
          f.name,
          f.size,
          f.mtime,
          m.taken,
          m.width,
          m.height,
          m.orientation,
          m.make,
          m.model,
          m.has_gps as i64,
          m.exif
        ],
        |r| r.get(0),
      )?;
      db::reindex_photo(&tx, id)?;
    }
  }
  db::refresh_folder(&tx, folder_id)?;
  tx.commit()?;
  Ok(Some(true))
}

fn list_images(dir: &Path) -> Vec<FileInfo> {
  let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
  rd.filter_map(Result::ok)
    .filter_map(|e| {
      let path = e.path();
      let ext = path.extension()?.to_string_lossy().to_lowercase();
      if !IMAGE_EXTS.contains(&ext.as_str()) {
        return None;
      }
      let md = e.metadata().ok()?;
      if !md.is_file() {
        return None;
      }
      Some(FileInfo {
        name: e.file_name().to_string_lossy().into_owned(),
        size: md.len() as i64,
        mtime: md.modified().map(local_naive_secs).unwrap_or(0),
        path,
      })
    })
    .collect()
}

/// Drop folders that vanished from disk or now fall outside the watched roots.
fn prune_missing_folders(db: &Arc<Mutex<Connection>>, roots: &[String], excluded: &[String], seen: &[String]) {
  let seen: std::collections::HashSet<&str> = seen.iter().map(String::as_str).collect();
  let roots_norm: Vec<String> = roots.iter().map(|r| normalize(r)).collect();
  let conn = db.lock().unwrap();
  let all: Vec<(i64, String)> = {
    let mut stmt = conn.prepare("SELECT id, path FROM folders").unwrap();
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    rows.filter_map(Result::ok).collect()
  };
  for (id, path) in all {
    let p = Path::new(&path);
    let under_root = roots_norm.iter().any(|r| normalize(&path).starts_with(r.as_str()));
    if !seen.contains(path.as_str()) && (!under_root || is_excluded(p, excluded) || !p.exists()) {
      let _ = conn.execute("DELETE FROM photos_fts WHERE rowid IN (SELECT id FROM photos WHERE folder_id = ?1)", [id]);
      let _ = conn.execute("DELETE FROM folders WHERE id = ?1", [id]);
    }
  }
}

fn read_meta(path: &Path) -> Meta {
  let (width, height) = imagesize::size(path).map(|s| (s.width as i64, s.height as i64)).unwrap_or((0, 0));
  let mut meta = Meta {
    width,
    height,
    taken: None,
    orientation: 1,
    make: String::new(),
    model: String::new(),
    has_gps: false,
    exif: "[]".into(),
  };
  let Ok(file) = File::open(path) else { return meta };
  let Ok(ex) = exif::Reader::new().read_from_container(&mut BufReader::new(file)) else {
    return meta;
  };

  let text = |tag: exif::Tag| -> Option<String> {
    ex.get_field(tag, exif::In::PRIMARY).map(|f| f.display_value().with_unit(&ex).to_string().trim_matches('"').trim().to_string())
  };
  meta.make = text(exif::Tag::Make).unwrap_or_default();
  meta.model = text(exif::Tag::Model).unwrap_or_default();
  if let Some(f) = ex.get_field(exif::Tag::Orientation, exif::In::PRIMARY) {
    meta.orientation = f.value.get_uint(0).unwrap_or(1) as i64;
  }
  meta.has_gps = ex.get_field(exif::Tag::GPSLatitude, exif::In::PRIMARY).is_some();
  meta.taken = [exif::Tag::DateTimeOriginal, exif::Tag::DateTimeDigitized, exif::Tag::DateTime]
    .iter()
    .find_map(|t| ex.get_field(*t, exif::In::PRIMARY))
    .and_then(|f| match &f.value {
      exif::Value::Ascii(v) if !v.is_empty() => parse_exif_date(&String::from_utf8_lossy(&v[0])),
      _ => None,
    });

  // Properties panel rows, in Picasa's order.
  let rows: &[(&str, exif::Tag)] = &[
    ("Camera Make", exif::Tag::Make),
    ("Camera Model", exif::Tag::Model),
    ("Camera Date", exif::Tag::DateTimeOriginal),
    ("Digitized Date", exif::Tag::DateTimeDigitized),
    ("Modified Date", exif::Tag::DateTime),
    ("Orientation", exif::Tag::Orientation),
    ("Flash", exif::Tag::Flash),
    ("Focal Length", exif::Tag::FocalLength),
    ("Focal Length in 35mm Film", exif::Tag::FocalLengthIn35mmFilm),
    ("Exposure Time", exif::Tag::ExposureTime),
    ("Aperture", exif::Tag::ApertureValue),
    ("F Number", exif::Tag::FNumber),
    ("ISO", exif::Tag::PhotographicSensitivity),
    ("White Balance", exif::Tag::WhiteBalance),
    ("Metering Mode", exif::Tag::MeteringMode),
    ("Exposure Program", exif::Tag::ExposureProgram),
    ("Color Space", exif::Tag::ColorSpace),
    ("Lens", exif::Tag::LensModel),
    ("Latitude", exif::Tag::GPSLatitude),
    ("Longitude", exif::Tag::GPSLongitude),
  ];
  let pairs: Vec<(&str, String)> = rows
    .iter()
    .filter_map(|(label, tag)| {
      if *tag == exif::Tag::Orientation {
        return Some((*label, orientation_name(meta.orientation).to_string()));
      }
      text(*tag).map(|v| (*label, v))
    })
    .collect();
  meta.exif = serde_json::to_string(&pairs).unwrap_or_else(|_| "[]".into());
  meta
}

fn orientation_name(o: i64) -> &'static str {
  match o {
    2 => "Mirrored",
    3 => "Rotated 180°",
    4 => "Flipped vertically",
    5 => "Mirrored, rotated 90° CW",
    6 => "Rotated 90° CW",
    7 => "Mirrored, rotated 90° CCW",
    8 => "Rotated 90° CCW",
    _ => "Normal",
  }
}

fn parse_exif_date(s: &str) -> Option<i64> {
  chrono::NaiveDateTime::parse_from_str(s.trim(), "%Y:%m:%d %H:%M:%S").ok().map(|d| d.and_utc().timestamp())
}

/// Times are stored as "naive local" seconds so the UI can format them without timezone drift.
fn local_naive_secs(t: SystemTime) -> i64 {
  chrono::DateTime::<chrono::Local>::from(t).naive_local().and_utc().timestamp()
}

fn normalize(p: &str) -> String {
  let mut s = p.replace('/', "\\").to_lowercase();
  if !s.ends_with('\\') {
    s.push('\\');
  }
  s
}

fn is_excluded(path: &Path, excluded: &[String]) -> bool {
  let p = normalize(&path.to_string_lossy());
  excluded.iter().any(|x| p.starts_with(x.as_str()))
}
