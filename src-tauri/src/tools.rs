//! Tools menu jobs that work across the library: Experimental › Show Duplicate Files,
//! Adjust Date and Time, and Back Up Pictures.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use rayon::prelude::*;
use rusqlite::params;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::AppState;

type CmdResult<T> = Result<T, String>;
fn err(e: impl std::fmt::Display) -> String {
  e.to_string()
}

/// Cancels the running duplicate search or backup.
static CANCEL: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn cancel_tool() {
  CANCEL.store(true, Ordering::Relaxed);
}

#[derive(Serialize, Clone)]
struct Progress {
  done: usize,
  total: usize,
}

/// Same size, and the same bytes at the start, middle and end: a duplicate. Reading 3×64 KB per
/// candidate keeps this quick on large libraries and slow disks.
fn fingerprint(path: &Path, size: u64) -> Option<[u8; 32]> {
  const CHUNK: u64 = 64 * 1024;
  let mut f = std::fs::File::open(path).ok()?;
  let mut h = Sha256::new();
  let mut buf = vec![0u8; CHUNK as usize];
  let mut offsets = vec![0];
  if size > CHUNK * 2 {
    offsets.push(size / 2 - CHUNK / 2);
  }
  if size > CHUNK {
    offsets.push(size.saturating_sub(CHUNK));
  }
  for at in offsets {
    f.seek(SeekFrom::Start(at)).ok()?;
    let n = f.read(&mut buf).ok()?;
    h.update(&buf[..n]);
  }
  Some(h.finalize().into())
}

/// Tools › Experimental › Show Duplicate Files: sets of pictures with identical contents.
/// Online-only cloud files are skipped (reading them would download them).
#[tauri::command]
pub async fn find_duplicates(app: AppHandle) -> CmdResult<Vec<Vec<i64>>> {
  CANCEL.store(false, Ordering::Relaxed);
  tauri::async_runtime::spawn_blocking(move || -> CmdResult<Vec<Vec<i64>>> {
    let rows: Vec<(i64, String, i64)> = {
      let state = app.state::<AppState>();
      let conn = state.db.lock().map_err(err)?;
      let mut stmt = conn
        .prepare(
          "SELECT id, path, size FROM photos WHERE cloud = 0 AND size > 0 AND size IN
             (SELECT size FROM photos WHERE cloud = 0 AND size > 0 GROUP BY size HAVING COUNT(*) > 1)
           ORDER BY size",
        )
        .map_err(err)?;
      let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(err)?;
      rows.filter_map(Result::ok).collect()
    };
    let total = rows.len();
    let done = AtomicUsize::new(0);
    let mut last = Instant::now();
    let mut prints: Vec<(i64, i64, [u8; 32])> = Vec::with_capacity(total);
    for chunk in rows.chunks(256) {
      if CANCEL.load(Ordering::Relaxed) {
        return Err("cancelled".into());
      }
      let part: Vec<_> = chunk
        .par_iter()
        .filter_map(|(id, path, size)| {
          done.fetch_add(1, Ordering::Relaxed);
          fingerprint(Path::new(path), *size as u64).map(|fp| (*id, *size, fp))
        })
        .collect();
      prints.extend(part);
      if last.elapsed() > Duration::from_millis(200) {
        last = Instant::now();
        let _ = app.emit("tool-progress", Progress { done: done.load(Ordering::Relaxed), total });
      }
    }
    let mut sets: HashMap<(i64, [u8; 32]), Vec<i64>> = HashMap::new();
    for (id, size, fp) in prints {
      sets.entry((size, fp)).or_default().push(id);
    }
    let mut out: Vec<Vec<i64>> = sets.into_values().filter(|s| s.len() > 1).collect();
    out.sort_by_key(|s| s[0]);
    log::info!("duplicates: {} sets among {total} candidates", out.len());
    Ok(out)
  })
  .await
  .map_err(err)?
}

/// Tools › Adjust Date and Time: moves the pictures' dates by `delta` seconds (or, with `reset`,
/// back to the camera's date). The new date is recorded in the folder's .picaluma.ini; the
/// pictures themselves are not changed.
#[tauri::command(async)]
pub fn adjust_dates(app: AppHandle, state: State<'_, AppState>, ids: Vec<i64>, delta: i64, reset: bool) -> CmdResult<()> {
  let rows: Vec<(i64, String, i64)> = {
    let conn = state.db.lock().map_err(err)?;
    let mut stmt = conn.prepare_cached("SELECT path, COALESCE(taken, mtime) FROM photos WHERE id = ?1").map_err(err)?;
    ids.iter().filter_map(|id| stmt.query_row([id], |r| Ok((*id, r.get(0)?, r.get(1)?))).ok()).collect()
  };
  for (_, path, taken) in &rows {
    let value = (!reset).then(|| (taken + delta).to_string());
    if let Err(e) = crate::folderini::save_value(Path::new(path), "date", value.as_deref()) {
      log::warn!("date for {path}: {e}");
    }
  }
  let mut conn = state.db.lock().map_err(err)?;
  let tx = conn.transaction().map_err(err)?;
  for (id, _, taken) in &rows {
    if reset {
      // The camera's date comes back when the picture's details are read again.
      tx.execute("UPDATE photos SET taken_set = NULL, meta_done = 0 WHERE id = ?1", [id]).map_err(err)?;
    } else {
      tx.execute("UPDATE photos SET taken = ?1, taken_set = ?1 WHERE id = ?2", params![taken + delta, id]).map_err(err)?;
    }
  }
  let folders: Vec<i64> = {
    let mut stmt = tx.prepare("SELECT DISTINCT folder_id FROM photos WHERE id = ?1").map_err(err)?;
    rows.iter().filter_map(|(id, ..)| stmt.query_row([id], |r| r.get(0)).ok()).collect()
  };
  for f in folders {
    let _ = crate::db::refresh_folder(&tx, f);
  }
  tx.commit().map_err(err)?;
  if reset {
    crate::scanner::spawn_rescan(app);
  }
  Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPlan {
  /// Pictures in the chosen folders.
  files: usize,
  bytes: u64,
  /// Not in the backup yet, or changed since.
  new_files: usize,
  new_bytes: u64,
  /// Online-only cloud files, which are left out.
  cloud: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
  copied: usize,
  bytes: u64,
  failed: Vec<String>,
}

/// Where a folder goes in the backup: its whole path under the destination
/// (`D:\Photos\Trip` → `<dest>\D\Photos\Trip`), so folders never collide.
fn backup_dir(dest: &Path, folder: &str) -> PathBuf {
  let mut out = dest.to_path_buf();
  for part in Path::new(folder).components() {
    match part {
      std::path::Component::Prefix(p) => out.push(p.as_os_str().to_string_lossy().trim_end_matches(':').replace(['\\', '/', '?', '.'], "")),
      std::path::Component::Normal(n) => out.push(n),
      _ => {}
    }
  }
  out
}

/// Already backed up: same size and modified time.
fn up_to_date(src: &Path, dst: &Path) -> bool {
  match (std::fs::metadata(src), std::fs::metadata(dst)) {
    (Ok(a), Ok(b)) => a.len() == b.len() && a.modified().ok().zip(b.modified().ok()).is_some_and(|(x, y)| x.duration_since(y).unwrap_or_else(|e| e.duration()) < Duration::from_secs(2)),
    _ => false,
  }
}

struct BackupItem {
  src: PathBuf,
  dst: PathBuf,
  size: u64,
  cloud: bool,
}

fn backup_items(state: &State<'_, AppState>, folders: &[i64], dest: &Path) -> CmdResult<Vec<BackupItem>> {
  let conn = state.db.lock().map_err(err)?;
  let mut items = Vec::new();
  let mut fstmt = conn.prepare_cached("SELECT path FROM folders WHERE id = ?1").map_err(err)?;
  let mut pstmt = conn.prepare_cached("SELECT path, name, size, cloud FROM photos WHERE folder_id = ?1").map_err(err)?;
  for id in folders {
    let Ok(dir) = fstmt.query_row([id], |r| r.get::<_, String>(0)) else { continue };
    let to = backup_dir(dest, &dir);
    let rows = pstmt
      .query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)? != 0)))
      .map_err(err)?;
    for (path, name, size, cloud) in rows.filter_map(Result::ok) {
      items.push(BackupItem { src: PathBuf::from(path), dst: to.join(name), size: size.max(0) as u64, cloud });
    }
    // The folder's edits, stars and dates travel with the pictures.
    for ini in [".picaluma.ini", ".picasa.ini"] {
      let src = Path::new(&dir).join(ini);
      if let Ok(m) = std::fs::metadata(&src) {
        items.push(BackupItem { src, dst: to.join(ini), size: m.len(), cloud: false });
      }
    }
  }
  Ok(items)
}

/// Tools › Back Up Pictures: what a backup of these folders to `dest` would copy.
#[tauri::command(async)]
pub fn backup_plan(state: State<'_, AppState>, folders: Vec<i64>, dest: String) -> CmdResult<BackupPlan> {
  let items = backup_items(&state, &folders, Path::new(&dest))?;
  let mut plan = BackupPlan { files: 0, bytes: 0, new_files: 0, new_bytes: 0, cloud: 0 };
  for it in &items {
    if it.cloud {
      plan.cloud += 1;
      continue;
    }
    plan.files += 1;
    plan.bytes += it.size;
    if dest.is_empty() || !up_to_date(&it.src, &it.dst) {
      plan.new_files += 1;
      plan.new_bytes += it.size;
    }
  }
  Ok(plan)
}

/// Copies the pictures of these folders that aren't in the backup yet (or changed since),
/// keeping their dates. Nothing in the backup is ever deleted.
#[tauri::command]
pub async fn backup_run(app: AppHandle, folders: Vec<i64>, dest: String) -> CmdResult<BackupResult> {
  CANCEL.store(false, Ordering::Relaxed);
  if dest.is_empty() {
    return Err("Choose where to back up to.".into());
  }
  let items = backup_items(&app.state::<AppState>(), &folders, Path::new(&dest))?;
  tauri::async_runtime::spawn_blocking(move || -> CmdResult<BackupResult> {
    let todo: Vec<&BackupItem> = items.iter().filter(|it| !it.cloud && !up_to_date(&it.src, &it.dst)).collect();
    let total = todo.len();
    let mut res = BackupResult { copied: 0, bytes: 0, failed: Vec::new() };
    let mut last = Instant::now();
    for (i, it) in todo.iter().enumerate() {
      if CANCEL.load(Ordering::Relaxed) {
        res.failed.push("Backup stopped before it finished.".into());
        break;
      }
      let ok = it.dst.parent().map_or(Ok(()), std::fs::create_dir_all).and_then(|_| copy_keeping_date(&it.src, &it.dst));
      match ok {
        Ok(()) => {
          res.copied += 1;
          res.bytes += it.size;
        }
        Err(e) => res.failed.push(format!("{}: {e}", it.src.display())),
      }
      if last.elapsed() > Duration::from_millis(200) || i + 1 == total {
        last = Instant::now();
        let _ = app.emit("tool-progress", Progress { done: i + 1, total });
      }
    }
    log::info!("backup to {dest}: {} copied, {} failed", res.copied, res.failed.len());
    Ok(res)
  })
  .await
  .map_err(err)?
}

/// Copies through a temporary name so a stopped backup never leaves a half-written picture.
fn copy_keeping_date(src: &Path, dst: &Path) -> std::io::Result<()> {
  let tmp = dst.with_extension("picaluma-part");
  std::fs::copy(src, &tmp)?;
  let a = std::fs::metadata(src)?;
  if std::fs::metadata(&tmp)?.len() != a.len() {
    let _ = std::fs::remove_file(&tmp);
    return Err(std::io::Error::other("the copy is incomplete"));
  }
  if let Ok(t) = a.modified() {
    std::fs::File::options().write(true).open(&tmp)?.set_modified(t)?;
  }
  std::fs::rename(&tmp, dst)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn backup_keeps_the_whole_path() {
    let d = backup_dir(Path::new("/backup"), if cfg!(windows) { r"D:\Photos\Trip" } else { "/home/me/Photos/Trip" });
    let s = d.to_string_lossy().replace('\\', "/");
    assert!(s.ends_with("Photos/Trip"), "{s}");
    if cfg!(windows) {
      assert_eq!(s, "/backup/D/Photos/Trip");
    }
  }

  #[test]
  fn same_bytes_same_fingerprint() {
    let dir = std::env::temp_dir().join(format!("picaluma-dups-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let data: Vec<u8> = (0..300_000u32).map(|i| (i * 7 % 251) as u8).collect();
    std::fs::write(dir.join("a.jpg"), &data).unwrap();
    std::fs::write(dir.join("b.jpg"), &data).unwrap();
    let mut other = data.clone();
    other[299_000] ^= 1;
    std::fs::write(dir.join("c.jpg"), &other).unwrap();
    let fp = |n: &str| fingerprint(&dir.join(n), data.len() as u64);
    assert_eq!(fp("a.jpg"), fp("b.jpg"));
    assert_ne!(fp("a.jpg"), fp("c.jpg"));
    std::fs::remove_dir_all(&dir).ok();
  }
}
