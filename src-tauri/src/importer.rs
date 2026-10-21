//! File › Import From, the Picasa way: pick a camera, memory card or folder, see what's on it
//! (pictures already in the library are marked), and copy the chosen ones into a new folder of
//! the library — optionally clearing them off the card afterwards.

use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::AppState;

type CmdResult<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
  e.to_string()
}

/// Files a scan listed: only these can be shown (thumb://localhost/file?p=…) or imported.
static LISTED: Mutex<Option<HashSet<String>>> = Mutex::new(None);
const MAX_FILES: usize = 50_000;

pub fn is_listed(path: &str) -> bool {
  LISTED.lock().unwrap().as_ref().is_some_and(|s| s.contains(path))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
  path: String,
  label: String,
}

/// Memory cards, cameras and USB drives, with their DCIM folder when they have one.
#[tauri::command]
pub fn import_sources() -> Vec<Source> {
  let with_dcim = |root: PathBuf, label: String| {
    let dcim = root.join("DCIM");
    let path = if dcim.is_dir() { dcim } else { root };
    Source { path: path.to_string_lossy().into_owned(), label }
  };
  removable_drives().into_iter().map(|(root, label)| with_dcim(root, label)).collect()
}

#[cfg(windows)]
fn removable_drives() -> Vec<(PathBuf, String)> {
  #[link(name = "kernel32")]
  extern "system" {
    fn GetDriveTypeW(root: *const u16) -> u32;
    fn GetVolumeInformationW(root: *const u16, name: *mut u16, name_len: u32, serial: *mut u32, max: *mut u32, flags: *mut u32, fs: *mut u16, fs_len: u32) -> i32;
  }
  const DRIVE_REMOVABLE: u32 = 2;
  let mut out = Vec::new();
  for letter in b'A'..=b'Z' {
    let root = format!("{}:\\", letter as char);
    let wide: Vec<u16> = root.encode_utf16().chain(Some(0)).collect();
    if unsafe { GetDriveTypeW(wide.as_ptr()) } != DRIVE_REMOVABLE || !Path::new(&root).exists() {
      continue;
    }
    let mut label = [0u16; 261];
    let ok = unsafe { GetVolumeInformationW(wide.as_ptr(), label.as_mut_ptr(), 261, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), 0) };
    let len = label.iter().position(|&c| c == 0).unwrap_or(0);
    let name = if ok != 0 && len > 0 { String::from_utf16_lossy(&label[..len]) } else { "Removable disk".into() };
    out.push((PathBuf::from(&root), format!("{name} ({}:)", letter as char)));
  }
  out
}

#[cfg(target_os = "macos")]
fn removable_drives() -> Vec<(PathBuf, String)> {
  // Every volume except the startup disk (which /Volumes links back to "/").
  let Ok(rd) = std::fs::read_dir("/Volumes") else { return Vec::new() };
  rd.filter_map(Result::ok)
    .map(|e| e.path())
    .filter(|p| std::fs::canonicalize(p).map(|c| c != Path::new("/")).unwrap_or(false))
    .map(|p| {
      let label = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
      (p, label)
    })
    .collect()
}

#[cfg(all(unix, not(target_os = "macos")))]
fn removable_drives() -> Vec<(PathBuf, String)> {
  let user = std::env::var("USER").unwrap_or_default();
  [format!("/media/{user}"), format!("/run/media/{user}")]
    .iter()
    .filter_map(|d| std::fs::read_dir(d).ok())
    .flatten()
    .filter_map(Result::ok)
    .map(|e| {
      let label = e.file_name().to_string_lossy().into_owned();
      (e.path(), label)
    })
    .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
  path: String,
  name: String,
  size: u64,
  /// Date taken (pictures with EXIF), else the file's date; local wall-clock seconds.
  date: i64,
  /// Already in the library (same name and size): Picasa's "exclude duplicates".
  duplicate: bool,
  video: bool,
}

/// Everything importable under `path` (sub-folders included), oldest first.
#[tauri::command]
pub async fn scan_import(app: AppHandle, path: String) -> CmdResult<Vec<Item>> {
  tauri::async_runtime::spawn_blocking(move || {
    let mut files = Vec::new();
    for e in walkdir::WalkDir::new(&path).max_depth(8).into_iter().filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.')) {
      let Ok(e) = e else { continue };
      if e.file_type().is_file() && crate::formats::is_media(e.path()) {
        files.push(e.into_path());
        if files.len() >= MAX_FILES {
          break;
        }
      }
    }
    let db = app.state::<AppState>().db.clone();
    let mut items = Vec::with_capacity(files.len());
    for p in files {
      let Ok(md) = std::fs::metadata(&p) else { continue };
      let path = p.to_string_lossy().into_owned();
      let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
      let video = crate::formats::is_video(&path);
      let date = (!video).then(|| taken(&p)).flatten().unwrap_or_else(|| md.modified().map(crate::scanner::local_naive_secs).unwrap_or(0));
      let duplicate = {
        let conn = db.lock().unwrap();
        conn
          .query_row("SELECT 1 FROM photos WHERE name = ?1 COLLATE NOCASE AND size = ?2 LIMIT 1", params![name, md.len() as i64], |_| Ok(()))
          .optional()
          .ok()
          .flatten()
          .is_some()
      };
      items.push(Item { path, name, size: md.len(), date, duplicate, video });
    }
    items.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.name.cmp(&b.name)));
    *LISTED.lock().unwrap() = Some(items.iter().map(|i| i.path.clone()).collect());
    Ok(items)
  })
  .await
  .map_err(err)?
}

/// Date taken from the first 256 KB (where EXIF lives), without reading the whole file.
fn taken(p: &Path) -> Option<i64> {
  let mut head = Vec::with_capacity(256 * 1024);
  std::fs::File::open(p).ok()?.take(256 * 1024).read_to_end(&mut head).ok()?;
  crate::scanner::exif_taken(&head)
}

/// Where imports go unless the user picks somewhere else: the Pictures folder.
#[tauri::command]
pub fn import_default_dest(app: AppHandle) -> String {
  app.path().picture_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default()
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
  done: usize,
  total: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
  folder: String,
  copied: usize,
  failed: Vec<String>,
  deleted: usize,
}

/// Copies the files into `dest/folder` (keeping their dates; never overwriting), makes sure the
/// library watches that place, and with `delete_after` removes the originals that copied fine.
#[tauri::command]
pub async fn import_files(app: AppHandle, files: Vec<String>, dest: String, folder: String, delete_after: bool) -> CmdResult<ImportResult> {
  let folder_name: String = folder.chars().map(|c| if r#"<>:"/\|?*"#.contains(c) { '-' } else { c }).collect::<String>().trim().trim_end_matches('.').to_string();
  if folder_name.is_empty() {
    return Err("Type a name for the new folder.".into());
  }
  let target_dir = Path::new(&dest).join(&folder_name);
  let app2 = app.clone();
  let result = tauri::async_runtime::spawn_blocking(move || -> CmdResult<ImportResult> {
    std::fs::create_dir_all(&target_dir).map_err(|e| format!("Couldn't create {}: {e}", target_dir.display()))?;
    let total = files.len();
    let (mut copied, mut failed, mut deleted) = (0usize, Vec::new(), 0usize);
    let mut last = Instant::now();
    for (i, src) in files.iter().enumerate() {
      if !is_listed(src) {
        failed.push(format!("{src}: not part of this import"));
        continue;
      }
      let src_path = Path::new(src);
      let name = src_path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
      let target = crate::fileops::unique_target(&target_dir, name.clone());
      match copy_keeping_date(src_path, &target) {
        Ok(()) => {
          copied += 1;
          if delete_after && std::fs::remove_file(src_path).is_ok() {
            deleted += 1;
          }
        }
        Err(e) => failed.push(format!("{name}: {e}")),
      }
      if last.elapsed() > Duration::from_millis(200) || i + 1 == total {
        last = Instant::now();
        let _ = app2.emit("import-progress", ImportProgress { done: i + 1, total });
      }
    }
    Ok(ImportResult { folder: target_dir.to_string_lossy().into_owned(), copied, failed, deleted })
  })
  .await
  .map_err(err)??;
  ensure_watched(&app, &dest);
  crate::scanner::spawn_rescan(app);
  Ok(result)
}

fn copy_keeping_date(src: &Path, dst: &Path) -> std::io::Result<()> {
  std::fs::copy(src, dst)?;
  let (a, b) = (std::fs::metadata(src)?, std::fs::metadata(dst)?);
  if a.len() != b.len() {
    let _ = std::fs::remove_file(dst);
    return Err(std::io::Error::other("the copy is incomplete"));
  }
  if let Ok(t) = a.modified() {
    std::fs::File::options().write(true).open(dst)?.set_modified(t)?;
  }
  Ok(())
}

/// The import destination becomes a watched folder unless one already covers it.
fn ensure_watched(app: &AppHandle, dest: &str) {
  let state = app.state::<AppState>();
  let conn = state.db.lock().unwrap();
  let norm = |p: &str| p.replace('\\', "/").trim_end_matches('/').to_lowercase();
  let d = norm(dest);
  let covered = conn
    .prepare("SELECT path FROM roots WHERE excluded = 0")
    .and_then(|mut s| s.query_map([], |r| r.get::<_, String>(0)).map(|rows| rows.filter_map(Result::ok).collect::<Vec<_>>()))
    .unwrap_or_default()
    .iter()
    .any(|r| {
      let r = norm(r);
      d == r || d.starts_with(&format!("{r}/"))
    });
  if !covered {
    let _ = conn.execute("INSERT INTO roots(path, excluded) VALUES (?1, 0) ON CONFLICT(path) DO UPDATE SET excluded = 0", [dest]);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn copies_keep_their_date() {
    let dir = std::env::temp_dir().join(format!("picaluma-import-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let src = dir.join("IMG_1.JPG");
    std::fs::write(&src, b"jpeg bytes").unwrap();
    let old = std::time::SystemTime::UNIX_EPOCH + Duration::from_secs(1_300_000_000);
    std::fs::File::options().write(true).open(&src).unwrap().set_modified(old).unwrap();
    let dst = dir.join("copy.jpg");
    copy_keeping_date(&src, &dst).unwrap();
    assert_eq!(std::fs::metadata(&dst).unwrap().modified().unwrap(), old);
    std::fs::remove_dir_all(&dir).ok();
  }
}
