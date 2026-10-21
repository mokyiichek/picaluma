//! Two-phase, Picasa-style scanning.
//!
//! 1. **Listing** walks the watched folders and records every picture from directory metadata
//!    alone (name, size, mtime). No file is opened, so even cloud-synced folders (Synology
//!    Drive, OneDrive placeholders) appear in the library within seconds, folder by folder.
//! 2. **Indexing** then reads just the start of each new or changed file (EXIF and dimensions
//!    live in the first few KB), newest folders first. Thumbnails need the whole file, so they're
//!    made when pictures scroll into view and by the background warmer afterwards: on hard disks
//!    and NAS drives, where reading 700k whole photos took days, dates and camera details now fill
//!    in quickly. Indexing yields to on-screen thumbnail requests and reports progress.
//!
//! Online-only cloud files (OneDrive, Synology Drive and Dropbox placeholders, everything on a
//! Google Drive streaming drive, macOS "dataless" File Provider files) are listed but skipped by
//! indexing and the thumbnail warmer: reading them would download the whole cloud library.
//! Their thumbnails are fetched only when they scroll into view.

use std::collections::{HashMap, HashSet};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use rayon::prelude::*;
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

use crate::db;
use crate::thumbs;
use crate::AppState;

use crate::formats;

/// Directory names never worth descending into, even when a whole drive is watched.
const SKIP_DIRS: &[&str] = &[
  "$recycle.bin", "system volume information", "windows", "program files", "program files (x86)",
  "programdata", "appdata", "node_modules", "recovery", "msocache", "$windows.~bt", "$windows.~ws",
];

/// macOS packages that look like folders but belong to an app (Photos/Lightroom libraries
/// contain previews and caches that would flood the library with duplicates).
const SKIP_BUNDLE_EXTS: &[&str] = &[
  "app", "photoslibrary", "photolibrary", "aplibrary", "migratedphotolibrary", "lrdata", "bundle", "framework",
  "plugin", "kext", "xcarchive", "pkg",
];

/// Top-level macOS system locations skipped when a whole disk or the home folder is watched.
#[cfg(target_os = "macos")]
fn is_system_dir(path: &Path) -> bool {
  const ROOTS: &[&str] = &["/System", "/Library", "/Applications", "/private", "/usr", "/bin", "/sbin", "/opt", "/cores", "/dev"];
  if ROOTS.iter().any(|r| path == Path::new(r)) {
    return true;
  }
  std::env::var_os("HOME").map(|h| path == Path::new(&h).join("Library")).unwrap_or(false)
}

/// Linux pseudo-filesystems and system trees, skipped when `/` or a whole disk is watched.
#[cfg(target_os = "linux")]
fn is_system_dir(path: &Path) -> bool {
  const ROOTS: &[&str] = &["/proc", "/sys", "/dev", "/run", "/tmp", "/var/lib", "/var/cache", "/usr", "/bin", "/sbin", "/lib", "/lib64", "/boot", "/etc", "/snap", "/opt"];
  if ROOTS.iter().any(|r| path == Path::new(r)) {
    return true;
  }
  // ~/.cache etc. are already skipped as hidden; Flatpak/Snap app data is not photos.
  std::env::var_os("HOME").map(|h| path == Path::new(&h).join("snap")).unwrap_or(false)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn is_system_dir(_path: &Path) -> bool {
  false
}

/// Whether the walker should skip a directory (below the watched root itself).
pub fn skip_dir(path: &Path) -> bool {
  let name = path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
  if name.starts_with('.') || name.starts_with('$') || SKIP_DIRS.contains(&name.as_str()) {
    return true;
  }
  if let Some(ext) = Path::new(&name).extension() {
    if SKIP_BUNDLE_EXTS.contains(&ext.to_string_lossy().as_ref()) {
      return true;
    }
  }
  is_system_dir(path)
}

/// How often the UI is told to reload while folders stream in.
const EVENT_THROTTLE: Duration = Duration::from_millis(400);
/// Photos indexed per DB transaction.
const INDEX_BATCH: usize = 48;
const INDEX_THREADS: usize = 4;
/// Indexing reads this much of each file; enough for EXIF (APP1 ≤ 64 KB) and the image header.
const HEADER_BYTES: u64 = 256 * 1024;

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
  pub scanning: bool,
  /// "listing" | "indexing" | "" (idle)
  pub phase: String,
  pub folders_seen: u64,
  pub photos_found: u64,
  pub indexed: u64,
  pub to_index: u64,
  pub current: String,
}

struct FileInfo {
  path: PathBuf,
  name: String,
  size: i64,
  mtime: i64,
  /// Online-only: the bytes live in the cloud and reading them would download the file.
  cloud: bool,
}

/// Windows: placeholder attributes set by OneDrive, Synology Drive, Dropbox and other Cloud Files
/// providers (OFFLINE, RECALL_ON_OPEN, RECALL_ON_DATA_ACCESS).
#[cfg(windows)]
fn is_online_only(md: &std::fs::Metadata) -> bool {
  use std::os::windows::fs::MetadataExt;
  md.file_attributes() & (0x1000 | 0x4_0000 | 0x40_0000) != 0
}

/// macOS: File Provider files (iCloud Drive, Google Drive, OneDrive, Dropbox) not on disk are "dataless".
#[cfg(target_os = "macos")]
fn is_online_only(md: &std::fs::Metadata) -> bool {
  use std::os::macos::fs::MetadataExt;
  md.st_flags() & 0x4000_0000 != 0
}

#[cfg(not(any(windows, target_os = "macos")))]
fn is_online_only(_md: &std::fs::Metadata) -> bool {
  false
}

/// Google Drive for desktop on Windows mounts a streaming drive (volume "Google Drive") that marks
/// nothing as online-only, yet reading any file downloads it. Treat all of it as cloud.
#[cfg(windows)]
pub fn is_streaming_volume(path: &Path) -> bool {
  #[link(name = "kernel32")]
  extern "system" {
    fn GetVolumePathNameW(file: *const u16, volume: *mut u16, len: u32) -> i32;
    fn GetVolumeInformationW(
      root: *const u16,
      name: *mut u16,
      name_len: u32,
      serial: *mut u32,
      max_component: *mut u32,
      flags: *mut u32,
      fs_name: *mut u16,
      fs_len: u32,
    ) -> i32;
  }
  let wide: Vec<u16> = path.as_os_str().to_string_lossy().encode_utf16().chain(Some(0)).collect();
  let mut root = [0u16; 512];
  let mut label = [0u16; 261];
  unsafe {
    if GetVolumePathNameW(wide.as_ptr(), root.as_mut_ptr(), root.len() as u32) == 0 {
      return false;
    }
    let ok = GetVolumeInformationW(
      root.as_ptr(),
      label.as_mut_ptr(),
      label.len() as u32,
      std::ptr::null_mut(),
      std::ptr::null_mut(),
      std::ptr::null_mut(),
      std::ptr::null_mut(),
      0,
    );
    if ok == 0 {
      return false;
    }
  }
  let len = label.iter().position(|&c| c == 0).unwrap_or(0);
  String::from_utf16_lossy(&label[..len]).eq_ignore_ascii_case("Google Drive")
}

#[cfg(not(windows))]
pub fn is_streaming_volume(_path: &Path) -> bool {
  false
}

pub struct Meta {
  pub width: i64,
  pub height: i64,
  pub taken: Option<i64>,
  pub orientation: i64,
  pub make: String,
  pub model: String,
  pub has_gps: bool,
  /// Where it was taken (EXIF GPS), in degrees.
  pub lat: Option<f64>,
  pub lon: Option<f64>,
  pub exif: String,
}

pub fn spawn_rescan(app: AppHandle) {
  let state = app.state::<AppState>();
  if state.scanning.swap(true, Ordering::SeqCst) {
    // A scan is running; ask it to go round once more when it finishes.
    state.rescan_requested.store(true, Ordering::SeqCst);
    return;
  }
  std::thread::spawn(move || loop {
    let state = app.state::<AppState>();
    state.rescan_requested.store(false, Ordering::SeqCst);
    run_scan(&app);
    if !state.rescan_requested.load(Ordering::SeqCst) {
      state.scanning.store(false, Ordering::SeqCst);
      break;
    }
  });
}

pub fn is_scanning(app: &AppHandle) -> bool {
  app.state::<AppState>().scanning.load(Ordering::SeqCst)
}

fn run_scan(app: &AppHandle) {
  let state = app.state::<AppState>();
  let db = state.db.clone();
  let started = Instant::now();
  let (roots, excluded) = load_roots(&db);
  crate::watch::refresh(app, &roots);
  let mut progress = ScanProgress { scanning: true, phase: "listing".into(), ..Default::default() };
  let mut last_emit = Instant::now() - EVENT_THROTTLE;
  let mut seen: Vec<String> = Vec::new();

  for root in &roots {
    let t = Instant::now();
    let before = progress.photos_found;
    list_root(app, &db, Path::new(root), &excluded, &mut progress, &mut last_emit, &mut seen);
    log::info!("listed {root}: {} photos in {:?}", progress.photos_found - before, t.elapsed());
  }
  prune_missing_folders(&db, &roots, &excluded, &seen);
  let _ = app.emit("library-changed", ());
  log::info!("listing finished: {} folders, {} photos in {:?}", progress.folders_seen, progress.photos_found, started.elapsed());

  index_pending(app, &db, &mut progress);

  progress = ScanProgress::default();
  let _ = app.emit("scan-progress", progress);
  let _ = app.emit("library-changed", ());
  log::info!("scan finished in {:?}", started.elapsed());
  if let Err(e) = db::compact(&db.lock().unwrap()) {
    log::warn!("compact: {e}");
  }
  thumbs::spawn_warmer(app.clone());
  backfill_places(app);
  // Then look for faces in new pictures (it waits for the thumbnails to finish).
  crate::people::kick(app);
}

pub(crate) fn load_roots(db: &Arc<Mutex<Connection>>) -> (Vec<String>, Vec<String>) {
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

// ---------------------------------------------------------------------------------------------
// Phase 1: listing
// ---------------------------------------------------------------------------------------------

fn list_root(
  app: &AppHandle,
  db: &Arc<Mutex<Connection>>,
  root: &Path,
  excluded: &[String],
  progress: &mut ScanProgress,
  last_emit: &mut Instant,
  seen: &mut Vec<String>,
) {
  let streaming = is_streaming_volume(root);
  let walker = WalkDir::new(root).follow_links(false).into_iter().filter_entry(|e| {
    if !e.file_type().is_dir() {
      return false;
    }
    if e.depth() == 0 {
      return true;
    }
    !skip_dir(e.path()) && !is_excluded(e.path(), excluded)
  });

  for entry in walker.filter_map(Result::ok) {
    let dir = entry.path();
    progress.folders_seen += 1;
    match list_dir(db, dir, streaming) {
      Ok(Some((count, changed))) => {
        seen.push(dir.to_string_lossy().into_owned());
        progress.photos_found += count as u64;
        if changed {
          progress.current = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        }
      }
      Ok(None) => {}
      Err(e) => log::warn!("list {}: {e}", dir.display()),
    }
    if last_emit.elapsed() >= EVENT_THROTTLE {
      *last_emit = Instant::now();
      let _ = app.emit("scan-progress", progress.clone());
      let _ = app.emit("library-changed", ());
    }
  }
}

/// Record one directory from metadata only. Returns Some((picture count, changed)) or None if
/// the directory holds no pictures.
fn list_dir(db: &Arc<Mutex<Connection>>, dir: &Path, streaming: bool) -> rusqlite::Result<Option<(usize, bool)>> {
  let files = list_images(dir, streaming);
  let dir_str = dir.to_string_lossy().into_owned();
  let mut conn = db.lock().unwrap();

  if files.is_empty() {
    conn.execute("DELETE FROM photos_fts WHERE rowid IN (SELECT p.id FROM photos p JOIN folders f ON f.id = p.folder_id WHERE f.path = ?1)", [&dir_str])?;
    conn.execute("DELETE FROM folders WHERE path = ?1", [&dir_str])?;
    return Ok(None);
  }

  let known: HashMap<String, (i64, i64, i64, bool)> = {
    let mut stmt = conn.prepare_cached(
      "SELECT p.path, p.id, p.size, p.mtime, p.cloud FROM photos p JOIN folders f ON f.id = p.folder_id WHERE f.path = ?1",
    )?;
    let rows = stmt.query_map([&dir_str], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?, r.get(3)?, r.get::<_, i64>(4)? != 0))))?;
    rows.filter_map(Result::ok).collect()
  };
  // A cloud file that has since been downloaded ("Always keep on this device") gets indexed now.
  let changed: Vec<&FileInfo> = files
    .iter()
    .filter(|f| match known.get(&*f.path.to_string_lossy()) {
      Some((_, size, mtime, cloud)) => *size != f.size || *mtime != f.mtime || (*cloud && !f.cloud),
      None => true,
    })
    .collect();
  let live: HashSet<String> = files.iter().map(|f| f.path.to_string_lossy().into_owned()).collect();
  let removed: Vec<i64> = known.iter().filter(|(p, _)| !live.contains(*p)).map(|(_, v)| v.0).collect();
  if changed.is_empty() && removed.is_empty() {
    return Ok(Some((files.len(), false)));
  }

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
      "INSERT INTO photos(folder_id, path, name, size, mtime, meta_done, cloud) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(path) DO UPDATE SET folder_id = excluded.folder_id, size = excluded.size,
         mtime = excluded.mtime, meta_done = excluded.meta_done, cloud = excluded.cloud, faces_done = 0
       RETURNING id",
    )?;
    for f in &changed {
      // Cloud files are complete as listed: indexing them would download them.
      let id: i64 = upsert.query_row(
        params![folder_id, f.path.to_string_lossy(), f.name, f.size, f.mtime, f.cloud as i64, f.cloud as i64],
        |r| r.get(0),
      )?;
      db::reindex_photo(&tx, id)?;
    }
  }
  db::refresh_folder(&tx, folder_id)?;
  tx.commit()?;
  Ok(Some((files.len(), true)))
}

fn list_images(dir: &Path, streaming: bool) -> Vec<FileInfo> {
  let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
  rd.filter_map(Result::ok)
    .filter_map(|e| {
      let path = e.path();
      if !formats::is_media(&path) {
        return None;
      }
      let md = e.metadata().ok()?;
      if !md.is_file() || md.len() == 0 {
        return None;
      }
      Some(FileInfo {
        name: e.file_name().to_string_lossy().into_owned(),
        size: md.len() as i64,
        mtime: md.modified().map(local_naive_secs).unwrap_or(0),
        cloud: streaming || is_online_only(&md),
        path,
      })
    })
    .collect()
}

/// Drop folders that vanished from disk or now fall outside the watched roots.
fn prune_missing_folders(db: &Arc<Mutex<Connection>>, roots: &[String], excluded: &[String], seen: &[String]) {
  let seen: HashSet<&str> = seen.iter().map(String::as_str).collect();
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

// ---------------------------------------------------------------------------------------------
// Phase 2: indexing (EXIF + thumbnail from one read)
// ---------------------------------------------------------------------------------------------

struct Pending {
  id: i64,
  folder_id: i64,
  path: String,
}

fn index_pending(app: &AppHandle, db: &Arc<Mutex<Connection>>, progress: &mut ScanProgress) {
  let pending: Vec<Pending> = {
    let conn = db.lock().unwrap();
    let mut stmt = conn
      .prepare(
        "SELECT p.id, p.folder_id, p.path FROM photos p JOIN folders f ON f.id = p.folder_id
         WHERE p.meta_done = 0 ORDER BY f.updated DESC, p.folder_id, p.name",
      )
      .unwrap();
    let rows = stmt
      .query_map([], |r| Ok(Pending { id: r.get(0)?, folder_id: r.get(1)?, path: r.get(2)? }))
      .unwrap();
    rows.filter_map(Result::ok).collect()
  };
  if pending.is_empty() {
    return;
  }
  let state = app.state::<AppState>();
  let queue = state.thumbs.clone();
  progress.phase = "indexing".into();
  progress.to_index = pending.len() as u64;
  progress.indexed = 0;
  let _ = app.emit("scan-progress", progress.clone());
  log::info!("indexing {} pictures", pending.len());

  let done = AtomicU64::new(0);
  let pool = rayon::ThreadPoolBuilder::new().num_threads(INDEX_THREADS).thread_name(|i| format!("index-{i}")).build().unwrap();
  let mut last_emit = Instant::now();

  for batch in pending.chunks(INDEX_BATCH) {
    // New listing requests (user added a folder) take priority over finishing this pass.
    if state.rescan_requested.load(Ordering::SeqCst) {
      break;
    }
    let metas: Vec<(&Pending, Meta)> = pool.install(|| {
      batch
        .par_iter()
        .map(|p| {
          while queue.pending() > 0 {
            std::thread::sleep(Duration::from_millis(30));
          }
          let meta = index_file(p);
          done.fetch_add(1, Ordering::Relaxed);
          (p, meta)
        })
        .collect()
    });

    save_metas(db, &metas);

    progress.indexed = done.load(Ordering::Relaxed);
    progress.current = batch
      .last()
      .and_then(|p| Path::new(&p.path).parent()?.file_name().map(|n| n.to_string_lossy().into_owned()))
      .unwrap_or_default();
    if last_emit.elapsed() >= Duration::from_millis(700) {
      last_emit = Instant::now();
      let _ = app.emit("scan-progress", progress.clone());
      let _ = app.emit("library-changed", ());
    }
  }
}

/// Stores indexed metadata for a batch of pictures in one transaction.
fn save_metas(db: &Arc<Mutex<Connection>>, metas: &[(&Pending, Meta)]) {
  let mut conn = db.lock().unwrap();
  let Ok(tx) = conn.transaction() else { return };
  let mut folders = HashSet::new();
  for (p, m) in metas {
    let _ = tx.execute(
      "UPDATE photos SET taken = ?1, width = ?2, height = ?3, orientation = ?4, make = ?5, model = ?6,
         has_gps = ?7, exif = ?8, lat = ?10, lon = ?11, meta_done = 1 WHERE id = ?9",
      params![m.taken, m.width, m.height, m.orientation, m.make, m.model, m.has_gps as i64, m.exif, p.id, m.lat, m.lon],
    );
    if !m.make.is_empty() || !m.model.is_empty() {
      let _ = db::reindex_photo(&tx, p.id);
    }
    folders.insert(p.folder_id);
  }
  for f in folders {
    let _ = db::refresh_folder(&tx, f);
  }
  // Merge full-text segments a little as we go, so a first scan of a big library doesn't
  // balloon the file before the final compaction.
  let _ = tx.execute("INSERT INTO photos_fts(photos_fts, rank) VALUES('merge', 64)", []);
  let _ = tx.commit();
}

/// Scanning priority, as in Picasa: when the user opens a folder mid-scan it is listed and
/// indexed straight away, ahead of the big pass (which may still be listing other drives).
pub(crate) fn scan_folder_now(app: &AppHandle, folder_id: i64) {
  let state = app.state::<AppState>();
  let db = state.db.clone();
  let path: Option<String> = db.lock().unwrap().query_row("SELECT path FROM folders WHERE id = ?1", [folder_id], |r| r.get(0)).ok();
  let Some(path) = path else { return };
  let started = Instant::now();
  let _ = list_folder(&db, Path::new(&path));
  let pending: Vec<Pending> = {
    let conn = db.lock().unwrap();
    let Ok(mut stmt) = conn.prepare("SELECT id, folder_id, path FROM photos WHERE folder_id = ?1 AND meta_done = 0 ORDER BY name") else { return };
    let rows = stmt.query_map([folder_id], |r| Ok(Pending { id: r.get(0)?, folder_id: r.get(1)?, path: r.get(2)? }));
    match rows {
      Ok(rows) => rows.filter_map(Result::ok).collect(),
      Err(_) => return,
    }
  };
  if !pending.is_empty() {
    let pool = rayon::ThreadPoolBuilder::new().num_threads(INDEX_THREADS).thread_name(|i| format!("priority-{i}")).build().unwrap();
    for batch in pending.chunks(INDEX_BATCH) {
      let metas: Vec<(&Pending, Meta)> = pool.install(|| batch.par_iter().map(|p| (p, index_file(p))).collect());
      save_metas(&db, &metas);
      let _ = app.emit("library-changed", ());
    }
  }
  let _ = app.emit("library-changed", ());
  log::info!("priority scan of {path}: {} pictures indexed in {:?}", pending.len(), started.elapsed());
}

/// EXIF and dimensions from the start of the file. TIFF and HEIF may keep EXIF further in, so
/// those are read whole when the header alone doesn't have it.
fn index_file(p: &Pending) -> Meta {
  use std::io::Read;
  let mut meta = empty_meta();
  let Ok(file) = std::fs::File::open(&p.path) else { return meta };
  let mut bytes = Vec::with_capacity(HEADER_BYTES as usize);
  if file.take(HEADER_BYTES).read_to_end(&mut bytes).is_err() {
    return meta;
  }
  if formats::is_video(&p.path) {
    // MP4/MOV keep their 'moov' header at the start or, when not "fast start", at the end.
    let (mut taken, mut w, mut h) = formats::video_info(&bytes);
    if taken.is_none() && w == 0 {
      if let Ok(mut f) = std::fs::File::open(&p.path) {
        use std::io::{Seek, SeekFrom};
        let len = f.metadata().map(|m| m.len()).unwrap_or(0);
        let mut tail = Vec::new();
        if f.seek(SeekFrom::Start(len.saturating_sub(4 << 20))).is_ok() && f.read_to_end(&mut tail).is_ok() {
          (taken, w, h) = formats::video_info(&tail);
        }
      }
    }
    meta.taken = taken.map(|t| local_naive_secs(SystemTime::UNIX_EPOCH + Duration::from_secs(t.max(0) as u64)));
    meta.width = w;
    meta.height = h;
    return meta;
  }
  let mut ex = exif::Reader::new().read_from_container(&mut Cursor::new(&bytes));
  let ext = Path::new(&p.path).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
  if ex.is_err() && bytes.len() as u64 == HEADER_BYTES && matches!(ext.as_str(), "tif" | "tiff" | "heic" | "heif" | "hif" | "avif" | "cr3") {
    if let Ok(all) = std::fs::read(&p.path) {
      bytes = all;
      ex = exif::Reader::new().read_from_container(&mut Cursor::new(&bytes));
    }
  }
  if let Ok(sz) = imagesize::blob_size(&bytes) {
    meta.width = sz.width as i64;
    meta.height = sz.height as i64;
  }
  if let Ok(ex) = ex {
    fill_exif(&mut meta, &ex);
  }
  meta
}

fn empty_meta() -> Meta {
  Meta { width: 0, height: 0, taken: None, orientation: 1, make: String::new(), model: String::new(), has_gps: false, lat: None, lon: None, exif: "[]".into() }
}

fn fill_exif(meta: &mut Meta, ex: &exif::Exif) {
  let text = |tag: exif::Tag| -> Option<String> {
    ex.get_field(tag, exif::In::PRIMARY).map(|f| f.display_value().with_unit(ex).to_string().trim_matches('"').trim().to_string())
  };
  meta.make = text(exif::Tag::Make).unwrap_or_default();
  meta.model = text(exif::Tag::Model).unwrap_or_default();
  if let Some(f) = ex.get_field(exif::Tag::Orientation, exif::In::PRIMARY) {
    meta.orientation = f.value.get_uint(0).unwrap_or(1) as i64;
  }
  meta.has_gps = ex.get_field(exif::Tag::GPSLatitude, exif::In::PRIMARY).is_some();
  if let Some((lat, lon)) = gps(ex) {
    meta.lat = Some(lat);
    meta.lon = Some(lon);
  }
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
  let orientation = meta.orientation;
  let pairs: Vec<(&str, String)> = rows
    .iter()
    .filter_map(|(label, tag)| {
      if *tag == exif::Tag::Orientation {
        return Some((*label, orientation_name(orientation).to_string()));
      }
      text(*tag).map(|v| (*label, v))
    })
    .collect();
  meta.exif = serde_json::to_string(&pairs).unwrap_or_else(|_| "[]".into());
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

/// Latitude and longitude in degrees from EXIF GPS (degrees, minutes, seconds and N/S/E/W).
pub(crate) fn gps(ex: &exif::Exif) -> Option<(f64, f64)> {
  let deg = |tag: exif::Tag, rtag: exif::Tag, neg: u8| -> Option<f64> {
    let f = ex.get_field(tag, exif::In::PRIMARY)?;
    let exif::Value::Rational(v) = &f.value else { return None };
    if v.is_empty() {
      return None;
    }
    let part = |i: usize| v.get(i).map(|r| r.to_f64()).filter(|x| x.is_finite()).unwrap_or(0.0);
    let d = part(0) + part(1) / 60.0 + part(2) / 3600.0;
    let negative = match ex.get_field(rtag, exif::In::PRIMARY).map(|r| &r.value) {
      Some(exif::Value::Ascii(a)) => a.first().and_then(|s| s.first()).is_some_and(|c| c.to_ascii_uppercase() == neg),
      _ => false,
    };
    Some(if negative { -d } else { d })
  };
  let lat = deg(exif::Tag::GPSLatitude, exif::Tag::GPSLatitudeRef, b'S')?;
  let lon = deg(exif::Tag::GPSLongitude, exif::Tag::GPSLongitudeRef, b'W')?;
  // (0, 0) is what cameras write when they had no fix.
  ((lat != 0.0 || lon != 0.0) && lat.abs() <= 90.0 && lon.abs() <= 180.0).then_some((lat, lon))
}

/// Pictures indexed before Picaluma kept GPS positions get them now (in the background).
pub fn backfill_places(app: &AppHandle) {
  let db = app.state::<AppState>().db.clone();
  let app = app.clone();
  std::thread::spawn(move || {
    let todo: Vec<(i64, String)> = {
      let conn = db.lock().unwrap();
      let mut stmt = match conn.prepare("SELECT id, path FROM photos WHERE has_gps = 1 AND lat IS NULL AND cloud = 0") {
        Ok(s) => s,
        Err(_) => return,
      };
      let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)));
      rows.map(|r| r.filter_map(Result::ok).collect()).unwrap_or_default()
    };
    if todo.is_empty() {
      return;
    }
    log::info!("places: reading GPS positions of {} pictures", todo.len());
    for chunk in todo.chunks(200) {
      while is_scanning(&app) {
        std::thread::sleep(std::time::Duration::from_secs(2));
      }
      let found: Vec<(i64, Option<(f64, f64)>)> = chunk
        .iter()
        .map(|(id, path)| {
          let mut head = Vec::with_capacity(256 * 1024);
          let pos = std::fs::File::open(path)
            .and_then(|f| std::io::Read::read_to_end(&mut std::io::Read::take(f, 256 * 1024), &mut head))
            .ok()
            .and_then(|_| exif::Reader::new().read_from_container(&mut std::io::Cursor::new(&head)).ok())
            .and_then(|ex| gps(&ex));
          (*id, pos)
        })
        .collect();
      let mut conn = db.lock().unwrap();
      if let Ok(tx) = conn.transaction() {
        for (id, pos) in found {
          // No usable position: clear the flag so it isn't read again.
          let _ = match pos {
            Some((lat, lon)) => tx.execute("UPDATE photos SET lat = ?1, lon = ?2 WHERE id = ?3", params![lat, lon, id]),
            None => tx.execute("UPDATE photos SET has_gps = 0 WHERE id = ?1", [id]),
          };
        }
        let _ = tx.commit();
      };
    }
    log::info!("places: done");
  });
}

/// Date taken from a file's first bytes (for Import, before the file is in the library).
pub(crate) fn exif_taken(head: &[u8]) -> Option<i64> {
  let ex = exif::Reader::new().read_from_container(&mut std::io::Cursor::new(head)).ok()?;
  [exif::Tag::DateTimeOriginal, exif::Tag::DateTimeDigitized, exif::Tag::DateTime]
    .iter()
    .find_map(|t| ex.get_field(*t, exif::In::PRIMARY))
    .and_then(|f| match &f.value {
      exif::Value::Ascii(v) if !v.is_empty() => parse_exif_date(&String::from_utf8_lossy(&v[0])),
      _ => None,
    })
}

fn parse_exif_date(s: &str) -> Option<i64> {
  chrono::NaiveDateTime::parse_from_str(s.trim(), "%Y:%m:%d %H:%M:%S").ok().map(|d| d.and_utc().timestamp())
}

/// Times are stored as "naive local" seconds so the UI can format them without timezone drift.
pub(crate) fn local_naive_secs(t: SystemTime) -> i64 {
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

// ---------------------------------------------------------------------------------------------
// Live updates (see watch.rs)
// ---------------------------------------------------------------------------------------------

/// A picture or video of an enabled file type (Options › File Types).
pub(crate) fn is_image(path: &Path) -> bool {
  formats::is_media(path)
}

/// Inside a watched folder, not excluded, and not inside a folder the scanner skips.
pub(crate) fn is_watched(path: &Path, roots: &[String], excluded: &[String]) -> bool {
  let p = normalize(&path.to_string_lossy());
  let Some(root) = roots.iter().find(|r| p.starts_with(normalize(r).as_str())) else { return false };
  if is_excluded(path, excluded) {
    return false;
  }
  let root_len = Path::new(root).components().count();
  let mut cur = Some(path);
  while let Some(c) = cur {
    if c.components().count() <= root_len {
      break;
    }
    if c.is_dir() && skip_dir(c) {
      return false;
    }
    cur = c.parent();
  }
  true
}

/// Drops a removed folder and everything below it from the library.
pub(crate) fn forget_tree(db: &Arc<Mutex<Connection>>, dir: &Path) {
  let d = dir.to_string_lossy().into_owned();
  let prefix = format!("{d}{}", std::path::MAIN_SEPARATOR);
  let conn = db.lock().unwrap();
  let _ = conn.execute(
    "DELETE FROM photos_fts WHERE rowid IN (SELECT p.id FROM photos p JOIN folders f ON f.id = p.folder_id
       WHERE f.path = ?1 OR substr(f.path, 1, length(?2)) = ?2)",
    params![d, prefix],
  );
  let _ = conn.execute("DELETE FROM folders WHERE path = ?1 OR substr(path, 1, length(?2)) = ?2", params![d, prefix]);
}

/// Lists one folder (live update).
pub(crate) fn list_folder(db: &Arc<Mutex<Connection>>, dir: &Path) -> rusqlite::Result<Option<(usize, bool)>> {
  list_dir(db, dir, is_streaming_volume(dir))
}

/// Lists a folder and all folders inside it (a folder created or moved into a watched folder).
pub(crate) fn list_tree(db: &Arc<Mutex<Connection>>, tree: &Path, excluded: &[String]) {
  let streaming = is_streaming_volume(tree);
  let walker = WalkDir::new(tree).follow_links(false).into_iter().filter_entry(|e| {
    e.file_type().is_dir() && (e.depth() == 0 || (!skip_dir(e.path()) && !is_excluded(e.path(), excluded)))
  });
  for entry in walker.filter_map(Result::ok) {
    let _ = list_dir(db, entry.path(), streaming);
  }
}

/// Indexes pictures added by a live update, with the scanning pop-up's progress.
pub(crate) fn index_new(app: &AppHandle, db: &Arc<Mutex<Connection>>, progress: &mut ScanProgress) {
  index_pending(app, db, progress);
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_dir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("picaluma-scan-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
  }

  fn write_jpeg(path: &Path) {
    let img = image::RgbImage::from_fn(640, 480, |x, y| image::Rgb([(x % 256) as u8, (y % 256) as u8, 128]));
    img.save(path).unwrap();
  }

  #[test]
  fn skips_hidden_system_and_bundle_folders() {
    let d = temp_dir("skip");
    for name in [".hidden", "$RECYCLE.BIN", "Photos Library.photoslibrary", "Lightroom Previews.lrdata", "Some.app", "node_modules"] {
      assert!(skip_dir(&d.join(name)), "{name} should be skipped");
    }
    for name in ["Holiday 2024", "Café Photos", "日本旅行", "My.Trip"] {
      assert!(!skip_dir(&d.join(name)), "{name} should be scanned");
    }
    #[cfg(target_os = "linux")]
    {
      assert!(skip_dir(Path::new("/proc")));
      assert!(skip_dir(Path::new("/sys")));
      assert!(!skip_dir(Path::new("/home/someone/Pictures")));
    }
    #[cfg(target_os = "macos")]
    {
      let home = std::env::var("HOME").unwrap();
      assert!(skip_dir(&Path::new(&home).join("Library")));
      assert!(skip_dir(Path::new("/System")));
      assert!(!skip_dir(&Path::new(&home).join("Pictures")));
    }
  }

  #[test]
  fn lists_unicode_folders_and_searches_them() {
    let d = temp_dir("unicode");
    let conn = Arc::new(Mutex::new(db::open(&d.join("library.db")).unwrap()));
    // Precomposed é, decomposed e + U+0301 (how macOS often stores names), and CJK.
    let dirs = [d.join("Caf\u{e9} Photos"), d.join("Cafe\u{301} Trip"), d.join("日本旅行")];
    for dir in &dirs {
      std::fs::create_dir_all(dir).unwrap();
      write_jpeg(&dir.join("IMG_0001.JPG"));
      write_jpeg(&dir.join("img_0002.jpeg"));
      std::fs::write(dir.join("notes.txt"), b"not a picture").unwrap();
    }
    for dir in &dirs {
      let (count, changed) = list_dir(&conn, dir, false).unwrap().expect("folder with pictures");
      assert_eq!((count, changed), (2, true), "{}", dir.display());
    }
    let c = conn.lock().unwrap();
    let hits = |q: &str| -> i64 { c.query_row("SELECT COUNT(*) FROM photos_fts WHERE photos_fts MATCH ?1", [q], |r| r.get(0)).unwrap() };
    assert_eq!(hits("\"cafe\"*"), 4, "accented folder names match plain typing, precomposed or not");
    assert_eq!(hits("\"café\"*"), 4);
    assert_eq!(hits("\"日本\"*"), 2, "CJK prefix search");
    assert_eq!(hits("\"img\"*"), 6, "file names are case-insensitive");
  }

  /// An online-only placeholder (OFFLINE attribute, as OneDrive/Synology set it) is listed as
  /// finished cloud item and never queued for indexing; once it's local it gets indexed.
  #[cfg(windows)]
  #[test]
  fn online_only_files_are_listed_without_reading() {
    let d = temp_dir("cloud");
    let conn = Arc::new(Mutex::new(db::open(&d.join("library.db")).unwrap()));
    let dir = d.join("OneDrive Pictures");
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("beach.jpg");
    write_jpeg(&file);
    let attrib = |flag: &str| assert!(std::process::Command::new("attrib").arg(flag).arg(&file).status().unwrap().success());
    attrib("+O");
    assert!(list_images(&dir, false)[0].cloud, "OFFLINE attribute marks a cloud placeholder");
    assert!(list_images(&dir, true)[0].cloud, "everything on a streaming drive is cloud");
    list_dir(&conn, &dir, false).unwrap();
    let state = |c: &Arc<Mutex<Connection>>| -> (i64, i64) {
      c.lock().unwrap().query_row("SELECT meta_done, cloud FROM photos", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap()
    };
    assert_eq!(state(&conn), (1, 1), "cloud files are not queued for indexing");
    attrib("-O");
    let (_, changed) = list_dir(&conn, &dir, false).unwrap().unwrap();
    assert!(changed, "a downloaded file is picked up");
    assert_eq!(state(&conn), (0, 0), "and queued for indexing");
  }

  /// Live updates: a new folder tree is listed, skipped folders are ignored, and a removed
  /// tree disappears from the library.
  #[test]
  fn live_update_helpers() {
    let d = temp_dir("live");
    let conn = Arc::new(Mutex::new(db::open(&d.join("library.db")).unwrap()));
    let root = d.join("Pictures");
    let trip = root.join("Trip").join("Day 1");
    std::fs::create_dir_all(&trip).unwrap();
    write_jpeg(&trip.join("a.jpg"));
    let roots = vec![root.to_string_lossy().into_owned()];
    assert!(is_watched(&trip.join("a.jpg"), &roots, &[]));
    assert!(!is_watched(&d.join("elsewhere.jpg"), &roots, &[]));
    let excluded = vec![normalize(&root.join("Trip").to_string_lossy())];
    assert!(!is_watched(&trip.join("a.jpg"), &roots, &excluded), "excluded folders are not watched");
    assert!(is_image(Path::new("x/IMG_1.JPG")) && !is_image(Path::new("x/IMG_1.jpg.crdownload")));

    list_tree(&conn, &root.join("Trip"), &[]);
    let count = |c: &Arc<Mutex<Connection>>| -> i64 { c.lock().unwrap().query_row("SELECT COUNT(*) FROM photos", [], |r| r.get(0)).unwrap() };
    assert_eq!(count(&conn), 1, "a folder moved in is listed with its subfolders");
    std::fs::remove_dir_all(root.join("Trip")).unwrap();
    forget_tree(&conn, &root.join("Trip"));
    assert_eq!(count(&conn), 0, "a removed folder tree leaves the library");
  }

  #[test]
  fn indexes_dimensions_from_the_header_only() {
    let d = temp_dir("index");
    let file = d.join("photo.jpg");
    write_jpeg(&file);
    // Pad the file far past the header: indexing must not need the rest.
    let mut bytes = std::fs::read(&file).unwrap();
    bytes.extend(std::iter::repeat_n(0u8, 2 * HEADER_BYTES as usize));
    std::fs::write(&file, bytes).unwrap();
    let p = Pending { id: 1, folder_id: 1, path: file.to_string_lossy().into_owned() };
    let meta = index_file(&p);
    assert_eq!((meta.width, meta.height), (640, 480));
  }

  #[cfg(target_os = "macos")]
  #[test]
  fn heic_is_listed_indexed_and_thumbnailed() {
    let d = temp_dir("heic");
    let jpg = d.join("src.jpg");
    write_jpeg(&jpg);
    let heic = d.join("IMG_1234.HEIC");
    let ok = std::process::Command::new("sips").args(["-s", "format", "heic"]).arg(&jpg).arg("--out").arg(&heic).status().unwrap();
    assert!(ok.success() && heic.exists(), "sips should create a HEIC test file");
    std::fs::remove_file(&jpg).unwrap();

    let files = list_images(&d, false);
    assert_eq!(files.len(), 1, "HEIC files are picked up on macOS");

    let p = Pending { id: 7, folder_id: 1, path: heic.to_string_lossy().into_owned() };
    let meta = index_file(&p);
    assert_eq!((meta.width, meta.height), (640, 480), "HEIC dimensions are read");
    let src = std::fs::read(&heic).unwrap();
    thumbs::write_thumb_from_bytes(&d.join("thumbs"), 1, &p.path, &src, meta.orientation);
    let thumb = walkdir::WalkDir::new(d.join("thumbs")).into_iter().filter_map(Result::ok).find(|e| e.file_type().is_file()).expect("thumbnail written");
    let img = image::open(thumb.path()).unwrap();
    assert!(img.width() <= 360 && img.height() <= 360 && img.width() > 0);
    assert!(crate::sysimg::system_image(&p.path, 1200).is_ok(), "HEIC converts for display");
  }
}