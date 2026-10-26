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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
  pictures: i64,
  videos: i64,
  bytes: i64,
  folders: i64,
  starred: i64,
  edited: i64,
  hidden: i64,
  geotagged: i64,
  people: i64,
  named_faces: i64,
  first: i64,
  last: i64,
  /// Pictures per year: (year, count), oldest first.
  years: Vec<(i64, i64)>,
  /// Most used cameras: (camera, count).
  cameras: Vec<(String, i64)>,
  /// File types: (extension, count, bytes).
  types: Vec<(String, i64, i64)>,
}

/// Tools › Library Statistics: what the library holds, by year, camera and file type.
#[tauri::command(async)]
pub fn library_stats(state: State<'_, AppState>) -> CmdResult<LibraryStats> {
  let conn = state.db.lock().map_err(err)?;
  let one = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap_or(0);
  let mut types: HashMap<String, (i64, i64, bool)> = HashMap::new();
  {
    let mut stmt = conn.prepare("SELECT path, size FROM photos").map_err(err)?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))).map_err(err)?;
    for (path, size) in rows.filter_map(Result::ok) {
      let ext = path.rsplit_once('.').map(|(_, e)| e.to_uppercase()).unwrap_or_default();
      let t = types.entry(ext).or_insert((0, 0, crate::formats::kind(&path) == crate::formats::Kind::Video));
      t.0 += 1;
      t.1 += size;
    }
  }
  let video_count: i64 = types.values().filter(|t| t.2).map(|t| t.0).sum();
  let mut types: Vec<(String, i64, i64)> = types.into_iter().map(|(e, (n, b, _))| (e, n, b)).collect();
  types.sort_by(|a, b| b.1.cmp(&a.1));
  let years = {
    let mut stmt = conn
      .prepare("SELECT CAST(strftime('%Y', COALESCE(taken, mtime), 'unixepoch') AS INTEGER) y, COUNT(*) FROM photos GROUP BY y ORDER BY y")
      .map_err(err)?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, Option<i64>>(0)?.unwrap_or(0), r.get(1)?))).map_err(err)?;
    rows.filter_map(Result::ok).filter(|(y, _)| *y > 1900).collect()
  };
  let cameras = {
    let mut stmt = conn
      .prepare(
        "SELECT TRIM(CASE WHEN instr(model, make) = 1 THEN model ELSE make || ' ' || model END) c, COUNT(*) n
         FROM photos WHERE model != '' GROUP BY c ORDER BY n DESC LIMIT 12",
      )
      .map_err(err)?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?;
    rows.filter_map(Result::ok).collect()
  };
  let total = one("SELECT COUNT(*) FROM photos");
  Ok(LibraryStats {
    pictures: total - video_count,
    videos: video_count,
    bytes: one("SELECT COALESCE(SUM(size), 0) FROM photos"),
    folders: one("SELECT COUNT(*) FROM folders WHERE photo_count > 0"),
    starred: one("SELECT COUNT(*) FROM photos WHERE starred = 1"),
    edited: one("SELECT COUNT(*) FROM photos WHERE edits != '' AND edits != '[]'"),
    hidden: one("SELECT COUNT(*) FROM photos WHERE hidden = 1"),
    geotagged: one("SELECT COUNT(*) FROM photos WHERE has_gps = 1"),
    people: one("SELECT COUNT(*) FROM people"),
    named_faces: one("SELECT COUNT(*) FROM faces WHERE person_id IS NOT NULL"),
    first: one("SELECT COALESCE(MIN(COALESCE(taken, mtime)), 0) FROM photos WHERE COALESCE(taken, mtime) > 0"),
    last: one("SELECT COALESCE(MAX(COALESCE(taken, mtime)), 0) FROM photos"),
    years,
    cameras,
    types: types.into_iter().take(12).collect(),
  })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
  /// Folder holding library.db, the thumbnails and settings.
  folder: String,
  database_bytes: u64,
  thumb_bytes: u64,
  thumb_files: u64,
}

/// Options › Library: where the library lives and how much room it takes.
#[tauri::command(async)]
pub fn library_info(state: State<'_, AppState>) -> LibraryInfo {
  let database_bytes = ["library.db", "library.db-wal"].iter().filter_map(|f| std::fs::metadata(state.data_dir.join(f)).ok()).map(|m| m.len()).sum();
  let (thumb_bytes, thumb_files) = crate::thumbs::cache_size(&state.thumb_dir);
  LibraryInfo { folder: state.data_dir.to_string_lossy().into_owned(), database_bytes, thumb_bytes, thumb_files }
}

/// Options › Library › Clear: thumbnails are made again as pictures come into view.
#[tauri::command(async)]
pub fn clear_thumbnail_cache(state: State<'_, AppState>) -> CmdResult<u64> {
  let (bytes, _) = crate::thumbs::cache_size(&state.thumb_dir);
  let Ok(rd) = std::fs::read_dir(&state.thumb_dir) else { return Ok(0) };
  for e in rd.flatten() {
    let p = e.path();
    let _ = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
  }
  log::info!("thumbnail cache cleared ({} MB)", bytes / 1_048_576);
  Ok(bytes)
}

/// Options › Library › Compact: merges the search index and rewrites the library file.
#[tauri::command(async)]
pub fn compact_library(state: State<'_, AppState>) -> CmdResult<()> {
  let conn = state.db.lock().map_err(err)?;
  conn.execute("INSERT INTO photos_fts(photos_fts) VALUES('optimize')", []).map_err(err)?;
  conn.execute_batch("VACUUM").map_err(err)?;
  conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(())).map_err(err)?;
  Ok(())
}

/// A 64-bit "difference hash" of a picture: each bit says whether a cell of a 9×8 grey grid is
/// brighter than its right neighbour. Resized, re-saved or lightly edited copies hash alike.
fn dhash(jpeg: &[u8]) -> Option<u64> {
  let img = image::load_from_memory(jpeg).ok()?;
  let small = img.resize_exact(9, 8, image::imageops::FilterType::Triangle).to_luma8();
  let mut h = 0u64;
  for y in 0..8 {
    for x in 0..8 {
      h = (h << 1) | (small.get_pixel(x, y)[0] > small.get_pixel(x + 1, y)[0]) as u64;
    }
  }
  Some(h)
}

/// Tools › Experimental › Find Similar Pictures: sets of pictures that look the same (resized,
/// re-saved, lightly edited, or exact copies). Fingerprints are kept, so later searches are quick.
#[tauri::command]
pub async fn find_similar(app: AppHandle) -> CmdResult<Vec<Vec<i64>>> {
  CANCEL.store(false, Ordering::Relaxed);
  tauri::async_runtime::spawn_blocking(move || -> CmdResult<Vec<Vec<i64>>> {
    let state = app.state::<AppState>();
    let thumb_dir = state.thumb_dir.clone();
    let todo: Vec<(i64, String, i64, i64)> = {
      let conn = state.db.lock().map_err(err)?;
      let mut stmt = conn.prepare("SELECT id, path, mtime, orientation FROM photos WHERE dhash IS NULL AND cloud = 0").map_err(err)?;
      let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get::<_, String>(1)?, r.get(2)?, r.get::<_, Option<i64>>(3)?.unwrap_or(1)))).map_err(err)?;
      rows.filter_map(Result::ok).filter(|(_, p, ..)| crate::formats::kind(p) != crate::formats::Kind::Video).collect()
    };
    let total = todo.len();
    let mut last = Instant::now();
    for (n, chunk) in todo.chunks(64).enumerate() {
      if CANCEL.load(Ordering::Relaxed) {
        return Err("cancelled".into());
      }
      let hashes: Vec<(i64, i64)> = chunk
        .par_iter()
        .map(|(id, path, mtime, o)| {
          // 0 marks "couldn't be read", so it isn't tried again and again.
          let h = crate::thumbs::thumb_bytes(&thumb_dir, path, *mtime, *o).ok().and_then(|b| dhash(&b)).map_or(0, |h| h as i64);
          (*id, h)
        })
        .collect();
      {
        let mut conn = state.db.lock().map_err(err)?;
        let tx = conn.transaction().map_err(err)?;
        for (id, h) in &hashes {
          tx.execute("UPDATE photos SET dhash = ?1 WHERE id = ?2", params![h, id]).map_err(err)?;
        }
        tx.commit().map_err(err)?;
      }
      if last.elapsed() > Duration::from_millis(200) {
        last = Instant::now();
        let _ = app.emit("tool-progress", Progress { done: ((n + 1) * 64).min(total), total });
      }
    }
    let all: Vec<(i64, u64)> = {
      let conn = state.db.lock().map_err(err)?;
      let mut stmt = conn.prepare("SELECT id, dhash FROM photos WHERE dhash IS NOT NULL AND dhash != 0").map_err(err)?;
      let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get::<_, i64>(1)? as u64))).map_err(err)?;
      rows.filter_map(Result::ok).collect()
    };
    let sets = similar_sets(&all, 4);
    log::info!("similar pictures: {} sets among {} pictures ({total} newly fingerprinted)", sets.len(), all.len());
    Ok(sets)
  })
  .await
  .map_err(err)?
}

/// Groups fingerprints within `max` differing bits. Splitting the 64 bits into five bands means
/// two hashes that close share at least one band exactly, so only those pairs are compared.
fn similar_sets(all: &[(i64, u64)], max: u32) -> Vec<Vec<i64>> {
  fn find(p: &mut [usize], mut i: usize) -> usize {
    while p[i] != i {
      p[i] = p[p[i]];
      i = p[i];
    }
    i
  }
  let mut parent: Vec<usize> = (0..all.len()).collect();
  // Flat pictures (one colour, black frames) hash to almost all zeros or ones: leave them out.
  let ok = |h: u64| (8..=56).contains(&h.count_ones());
  for band in 0..5u32 {
    let shift = band * 13;
    let mut buckets: HashMap<u64, Vec<usize>> = HashMap::new();
    for (i, (_, h)) in all.iter().enumerate() {
      if ok(*h) {
        buckets.entry((h >> shift) & 0x1FFF).or_default().push(i);
      }
    }
    for list in buckets.values() {
      if list.len() > 400 {
        continue; // a crowded band says little; the other bands still catch real look-alikes
      }
      for a in 0..list.len() {
        for b in a + 1..list.len() {
          let (i, j) = (list[a], list[b]);
          if (all[i].1 ^ all[j].1).count_ones() <= max {
            let (ri, rj) = (find(&mut parent, i), find(&mut parent, j));
            if ri != rj {
              parent[ri] = rj;
            }
          }
        }
      }
    }
  }
  let mut sets: HashMap<usize, Vec<i64>> = HashMap::new();
  for (i, (id, _)) in all.iter().enumerate() {
    let r = find(&mut parent, i);
    sets.entry(r).or_default().push(*id);
  }
  let mut out: Vec<Vec<i64>> = sets.into_values().filter(|s| s.len() > 1).collect();
  for s in &mut out {
    s.sort_unstable();
  }
  out.sort_by_key(|s| s[0]);
  out
}

#[cfg(test)]
mod similar_tests {
  use super::*;

  #[test]
  fn near_hashes_group() {
    let a = 0x0F0F_F0F0_3C3C_A5A5u64;
    let sets = similar_sets(&[(1, a), (2, a ^ 0b101), (3, !a), (4, a ^ 0xFFFF)], 4);
    assert_eq!(sets, vec![vec![1, 2]]);
  }
}
