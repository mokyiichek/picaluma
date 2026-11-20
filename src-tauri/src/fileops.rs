//! Picture and folder file operations behind the right-click menus and the Delete key.
//!
//! Deletes always go to the Recycle Bin / Trash. Moves keep each photo's database row (and
//! therefore its stars, captions, tags, edits and album membership); copies are picked up by a
//! rescan like any other new file.

use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{AppHandle, State};

use crate::db;
use crate::scanner;
use crate::AppState;

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
  e.to_string()
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpResult {
  done: usize,
  failed: Vec<String>,
  /// Disk folders the operation left completely empty (Picasa then offered to delete them).
  empty_folders: Vec<String>,
  /// For Edit › Undo of a move: [id, path before the move] of each moved picture.
  moved: Vec<(i64, String)>,
  /// For Edit › Undo of a delete to the Recycle Bin / Trash (see `undo_delete`).
  undo: Option<i64>,
}

/// Move pictures to the Recycle Bin / Trash (or, with `permanent`, delete them outright —
/// Shift+Delete) and drop them from the library.
#[tauri::command(async)]
pub fn delete_photos(state: State<'_, AppState>, ids: Vec<i64>, permanent: Option<bool>) -> CmdResult<OpResult> {
  let permanent = permanent.unwrap_or(false);
  let photos = photo_paths(&state, &ids)?;
  let mut res = OpResult::default();
  let mut gone = Vec::new();
  // Trashed pictures can come back with Edit › Undo: (id, path, where it landed on macOS).
  let mut trashed: Vec<(i64, String, Option<String>)> = Vec::new();
  let outcome: Vec<Result<Option<PathBuf>, String>> = if permanent {
    photos.iter().map(|(_, p)| std::fs::remove_file(p).map(|_| None).map_err(err)).collect()
  } else {
    trash_files(&photos.iter().map(|(_, p)| Path::new(p.as_str())).collect::<Vec<_>>())
  };
  for ((id, path), out) in photos.into_iter().zip(outcome) {
    match out {
      Ok(landed) => {
        gone.push(id);
        res.done += 1;
        if !permanent {
          trashed.push((id, path, landed.map(|p| p.to_string_lossy().into_owned())));
        }
      }
      // Already gone from the disk: just forget it.
      Err(_) if !Path::new(&path).exists() => {
        gone.push(id);
        res.done += 1;
      }
      Err(_) => res.failed.push(path),
    }
  }
  let mut conn = state.db.lock().map_err(err)?;
  let tx = conn.transaction().map_err(err)?;
  if !trashed.is_empty() {
    let batch = chrono::Utc::now().timestamp_millis();
    stash_deleted(&tx, batch, &trashed).map_err(err)?;
    res.undo = Some(batch);
  }
  let folders = forget_photos(&tx, &gone).map_err(err)?;
  for f in folders {
    db::refresh_folder(&tx, f).map_err(err)?;
    if let Ok(dir) = tx.query_row("SELECT path FROM folders WHERE id = ?1", [f], |r| r.get::<_, String>(0)) {
      if dir_is_empty(Path::new(&dir)) {
        res.empty_folders.push(dir);
      }
    }
  }
  tx.commit().map_err(err)?;
  Ok(res)
}

fn dir_is_empty(dir: &Path) -> bool {
  std::fs::read_dir(dir).map(|mut entries| entries.next().is_none()).unwrap_or(false)
}

/// Removes a folder that is completely empty (after its last pictures were deleted) and drops it
/// from the library. Refuses anything that still holds a file.
#[tauri::command(async)]
pub fn remove_empty_folder(state: State<'_, AppState>, path: String) -> CmdResult<()> {
  let dir = PathBuf::from(&path);
  if !dir_is_empty(&dir) {
    return Err(format!("{path} is not empty."));
  }
  std::fs::remove_dir(&dir).map_err(err)?;
  let conn = state.db.lock().map_err(err)?;
  conn.execute("DELETE FROM folders WHERE path = ?1", [&path]).map_err(err)?;
  Ok(())
}

/// Move or copy pictures into `dest` (created if needed). Name clashes get " (2)", " (3)"…
#[tauri::command(async)]
pub fn transfer_photos(app: AppHandle, state: State<'_, AppState>, ids: Vec<i64>, dest: String, copy: bool) -> CmdResult<OpResult> {
  let dest_dir = PathBuf::from(&dest);
  std::fs::create_dir_all(&dest_dir).map_err(err)?;
  let photos = photo_paths(&state, &ids)?;
  let mut res = OpResult::default();
  let mut plan = Vec::new();
  for (id, path) in photos {
    let src = PathBuf::from(&path);
    if src.parent() == Some(dest_dir.as_path()) {
      continue; // already there
    }
    let target = unique_target(&dest_dir, src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
    if copy {
      match std::fs::copy(&src, &target) {
        Ok(_) => res.done += 1,
        Err(e) => res.failed.push(format!("{path}: {e}")),
      }
    } else {
      plan.push((id, src, target));
    }
  }
  relocate(&state, plan, &mut res)?;
  // Copies (and moves into folders outside the watched roots) are reconciled by a rescan.
  scanner::spawn_rescan(app);
  Ok(res)
}

/// Edit › Undo of a move: each picture goes back to where it was (beside a newcomer with the
/// same name, if one took its place meanwhile).
#[tauri::command(async)]
pub fn undo_move(app: AppHandle, state: State<'_, AppState>, moved: Vec<(i64, String)>) -> CmdResult<OpResult> {
  let mut res = OpResult::default();
  let mut plan = Vec::new();
  {
    let conn = state.db.lock().map_err(err)?;
    for (id, old) in moved {
      let Ok(cur) = conn.query_row("SELECT path FROM photos WHERE id = ?1", [id], |r| r.get::<_, String>(0)) else {
        res.failed.push(old);
        continue;
      };
      let (cur, old) = (PathBuf::from(cur), PathBuf::from(old));
      let (Some(dir), Some(name)) = (old.parent(), old.file_name()) else { continue };
      if cur == old {
        continue;
      }
      let target = if old.exists() { unique_target(dir, name.to_string_lossy().into_owned()) } else { old.clone() };
      plan.push((id, cur, target));
    }
  }
  for (_, _, target) in &plan {
    if let Some(dir) = target.parent() {
      let _ = std::fs::create_dir_all(dir);
    }
  }
  relocate(&state, plan, &mut res)?;
  res.moved.clear();
  scanner::spawn_rescan(app);
  Ok(res)
}

/// Moves pictures to new files, keeping their rows (stars, captions, tags, albums, faces) and
/// taking their record in the folders' .picaluma.ini along.
fn relocate(state: &State<'_, AppState>, plan: Vec<(i64, PathBuf, PathBuf)>, res: &mut OpResult) -> CmdResult<()> {
  let _writing = crate::folderini::EditWrite::begin();
  let mut moved = Vec::new();
  for (id, src, target) in plan {
    match move_file(&src, &target) {
      Ok(()) => {
        res.done += 1;
        res.moved.push((id, src.to_string_lossy().into_owned()));
        moved.push((id, src, target));
      }
      Err(e) => res.failed.push(format!("{}: {e}", src.display())),
    }
  }
  if moved.is_empty() {
    return Ok(());
  }
  let mut marks: Vec<(String, bool, bool)> = Vec::new();
  {
    let mut conn = state.db.lock().map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    let mut touched = Vec::new();
    for (id, _, target) in &moved {
      let dest_folder = ensure_folder(&tx, target.parent().ok_or("bad path")?).map_err(err)?;
      let (old, edits, star, hidden): (i64, String, i64, i64) = tx
        .query_row("SELECT folder_id, edits, starred, hidden FROM photos WHERE id = ?1", [id], |r| {
          Ok((r.get(0)?, r.get::<_, Option<String>>(1)?.unwrap_or_default(), r.get(2)?, r.get(3)?))
        })
        .map_err(err)?;
      touched.extend([old, dest_folder]);
      marks.push((edits, star != 0, hidden != 0));
      tx.execute(
        "UPDATE photos SET path = ?1, name = ?2, folder_id = ?3 WHERE id = ?4",
        params![target.to_string_lossy(), target.file_name().map(|n| n.to_string_lossy().into_owned()), dest_folder, id],
      )
      .map_err(err)?;
      db::reindex_photo(&tx, *id).map_err(err)?;
    }
    touched.sort_unstable();
    touched.dedup();
    for f in touched {
      db::refresh_folder(&tx, f).map_err(err)?;
    }
    tx.execute("DELETE FROM folders WHERE photo_count = 0", []).map_err(err)?;
    tx.commit().map_err(err)?;
  }
  for ((_, src, target), (edits, star, hidden)) in moved.iter().zip(marks) {
    let _ = crate::folderini::move_entry(src, target);
    // Marks that came from Picasa's .picasa.ini (which stays behind) are written out too.
    if !edits.is_empty() {
      let _ = crate::folderini::save_edits(target, &edits);
    }
    if star {
      let _ = crate::folderini::save_flag(target, "star", true);
    }
    if hidden {
      let _ = crate::folderini::save_flag(target, "hidden", true);
    }
  }
  Ok(())
}

/// Keeps what a delete to the Recycle Bin / Trash removed from the library (the pictures' rows,
/// album places, faces), so Edit › Undo can bring it all back. Kept until the app quits.
fn stash_deleted(conn: &Connection, batch: i64, trashed: &[(i64, String, Option<String>)]) -> rusqlite::Result<()> {
  conn.execute_batch(
    "CREATE TABLE IF NOT EXISTS undo_photos AS SELECT 0 AS undo_batch, * FROM photos WHERE 0;
     CREATE TABLE IF NOT EXISTS undo_album_photos AS SELECT 0 AS undo_batch, * FROM album_photos WHERE 0;
     CREATE TABLE IF NOT EXISTS undo_faces AS SELECT 0 AS undo_batch, * FROM faces WHERE 0;
     CREATE TABLE IF NOT EXISTS undo_face_rejects AS SELECT 0 AS undo_batch, * FROM face_rejects WHERE 0;
     CREATE TABLE IF NOT EXISTS undo_trash (undo_batch INTEGER NOT NULL, path TEXT NOT NULL, landed TEXT);",
  )?;
  for (id, path, landed) in trashed {
    conn.execute("INSERT INTO undo_photos SELECT ?1, * FROM photos WHERE id = ?2", params![batch, id])?;
    conn.execute("INSERT INTO undo_album_photos SELECT ?1, * FROM album_photos WHERE photo_id = ?2", params![batch, id])?;
    conn.execute("INSERT INTO undo_faces SELECT ?1, * FROM faces WHERE photo_id = ?2", params![batch, id])?;
    conn.execute(
      "INSERT INTO undo_face_rejects SELECT ?1, * FROM face_rejects WHERE face_id IN (SELECT id FROM faces WHERE photo_id = ?2)",
      params![batch, id],
    )?;
    conn.execute("INSERT INTO undo_trash VALUES (?1, ?2, ?3)", params![batch, path, landed])?;
  }
  Ok(())
}

fn columns(conn: &Connection, table: &str) -> rusqlite::Result<String> {
  let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
  let names: Vec<String> = stmt.query_map([], |r| r.get::<_, String>(1))?.filter_map(Result::ok).map(|n| format!("\"{n}\"")).collect();
  Ok(names.join(", "))
}

/// Edit › Undo of a delete: the pictures come back out of the Recycle Bin / Trash, with their
/// stars, captions, tags, edits, albums and faces.
#[tauri::command(async)]
pub fn undo_delete(state: State<'_, AppState>, batch: i64) -> CmdResult<OpResult> {
  let items: Vec<(String, Option<String>)> = {
    let conn = state.db.lock().map_err(err)?;
    let mut stmt = conn.prepare("SELECT path, landed FROM undo_trash WHERE undo_batch = ?1").map_err(err)?;
    let rows = stmt.query_map([batch], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?;
    rows.filter_map(Result::ok).collect()
  };
  if items.is_empty() {
    return Err("There is nothing to undo.".into());
  }
  let mut res = OpResult::default();
  let back = restore_from_trash(&items, &mut res.failed);
  res.done = back.len();
  let mut conn = state.db.lock().map_err(err)?;
  let tx = conn.transaction().map_err(err)?;
  restore_rows(&tx, batch, &back).map_err(err)?;
  for t in ["undo_photos", "undo_album_photos", "undo_faces", "undo_face_rejects", "undo_trash"] {
    tx.execute(&format!("DELETE FROM {t} WHERE undo_batch = ?1"), [batch]).map_err(err)?;
  }
  tx.commit().map_err(err)?;
  Ok(res)
}

fn restore_rows(conn: &Connection, batch: i64, paths: &[String]) -> rusqlite::Result<()> {
  let (photo_cols, album_cols, face_cols, reject_cols) =
    (columns(conn, "photos")?, columns(conn, "album_photos")?, columns(conn, "faces")?, columns(conn, "face_rejects")?);
  // A person or album deleted since then can't be pointed at any more.
  conn.execute(
    "UPDATE undo_faces SET person_id = NULL WHERE undo_batch = ?1 AND person_id IS NOT NULL AND person_id NOT IN (SELECT id FROM people)",
    [batch],
  )?;
  let mut folders = Vec::new();
  for path in paths {
    let Ok(id) = conn.query_row("SELECT id FROM undo_photos WHERE undo_batch = ?1 AND path = ?2", params![batch, path], |r| r.get::<_, i64>(0)) else {
      continue;
    };
    // A rescan may already have listed the restored file as a new picture: the old row wins.
    conn.execute("DELETE FROM photos_fts WHERE rowid IN (SELECT id FROM photos WHERE path = ?1)", [path])?;
    conn.execute("DELETE FROM photos WHERE path = ?1", [path])?;
    let Some(dir) = Path::new(path).parent() else { continue };
    let folder = ensure_folder(conn, dir)?;
    conn.execute("UPDATE undo_photos SET folder_id = ?1 WHERE undo_batch = ?2 AND id = ?3", params![folder, batch, id])?;
    // Its id taken by a new picture meanwhile: the next scan adds it as a new picture instead.
    if conn
      .execute(&format!("INSERT INTO photos({photo_cols}) SELECT {photo_cols} FROM undo_photos WHERE undo_batch = ?1 AND id = ?2"), params![batch, id])
      .is_err()
    {
      continue;
    }
    conn.execute(
      &format!("INSERT OR IGNORE INTO faces({face_cols}) SELECT {face_cols} FROM undo_faces WHERE undo_batch = ?1 AND photo_id = ?2"),
      params![batch, id],
    )?;
    conn.execute(
      &format!(
        "INSERT OR IGNORE INTO face_rejects({reject_cols}) SELECT {reject_cols} FROM undo_face_rejects
         WHERE undo_batch = ?1 AND face_id IN (SELECT id FROM faces WHERE photo_id = ?2) AND person_id IN (SELECT id FROM people)"
      ),
      params![batch, id],
    )?;
    conn.execute(
      &format!(
        "INSERT OR IGNORE INTO album_photos({album_cols}) SELECT {album_cols} FROM undo_album_photos
         WHERE undo_batch = ?1 AND photo_id = ?2 AND album_id IN (SELECT id FROM albums)"
      ),
      params![batch, id],
    )?;
    db::reindex_photo(conn, id)?;
    folders.push(folder);
  }
  folders.sort_unstable();
  folders.dedup();
  for f in folders {
    db::refresh_folder(conn, f)?;
  }
  Ok(())
}

/// Rename a folder on disk, keeping every photo's row.
#[tauri::command(async)]
pub fn rename_folder(state: State<'_, AppState>, id: i64, name: String) -> CmdResult<String> {
  let name = name.trim();
  if name.is_empty() || name.contains(['\\', '/', ':', '*', '?', '"', '<', '>', '|']) {
    return Err("That name contains characters a folder name can't have.".into());
  }
  let mut conn = state.db.lock().map_err(err)?;
  let old: String = conn.query_row("SELECT path FROM folders WHERE id = ?1", [id], |r| r.get(0)).map_err(err)?;
  let old_path = PathBuf::from(&old);
  let new_path = old_path.with_file_name(name);
  if new_path.exists() {
    return Err(format!("A folder named \"{name}\" already exists there."));
  }
  std::fs::rename(&old_path, &new_path).map_err(err)?;
  let tx = conn.transaction().map_err(err)?;
  rebase_paths(&tx, &old, &new_path.to_string_lossy()).map_err(err)?;
  tx.commit().map_err(err)?;
  Ok(new_path.to_string_lossy().into_owned())
}

/// File › Rename (F2): renames a picture on disk, keeping its extension and its row (stars,
/// captions, edits, albums). Returns the new file name.
#[tauri::command(async)]
pub fn rename_photo(state: State<'_, AppState>, id: i64, name: String) -> CmdResult<String> {
  let stem = name.trim();
  if stem.is_empty() || stem.contains(['\\', '/', ':', '*', '?', '"', '<', '>', '|']) {
    return Err("That name contains characters a file name can't have.".into());
  }
  let conn = state.db.lock().map_err(err)?;
  let old: String = conn.query_row("SELECT path FROM photos WHERE id = ?1", [id], |r| r.get(0)).map_err(err)?;
  let old_path = PathBuf::from(&old);
  let ext = old_path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
  // Accept "beach.jpg" as well as "beach" without doubling the extension.
  let stem = stem.strip_suffix(ext.as_str()).filter(|s| !ext.is_empty() && !s.is_empty()).unwrap_or(stem);
  let file_name = format!("{stem}{ext}");
  let new_path = old_path.with_file_name(&file_name);
  if new_path == old_path {
    return Ok(file_name);
  }
  // Case-only renames (beach.jpg → Beach.jpg) are allowed on case-insensitive disks.
  if new_path.exists() && !old.eq_ignore_ascii_case(&new_path.to_string_lossy()) {
    return Err(format!("A file named \"{file_name}\" already exists in that folder."));
  }
  std::fs::rename(&old_path, &new_path).map_err(err)?;
  conn
    .execute("UPDATE photos SET path = ?1, name = ?2 WHERE id = ?3", params![new_path.to_string_lossy(), file_name, id])
    .map_err(err)?;
  db::reindex_photo(&conn, id).map_err(err)?;
  Ok(file_name)
}

/// Move a folder (with everything inside it) into `dest_parent`.
#[tauri::command(async)]
pub fn move_folder(app: AppHandle, state: State<'_, AppState>, id: i64, dest_parent: String) -> CmdResult<String> {
  let old: String = {
    let conn = state.db.lock().map_err(err)?;
    conn.query_row("SELECT path FROM folders WHERE id = ?1", [id], |r| r.get(0)).map_err(err)?
  };
  let old_path = PathBuf::from(&old);
  let name = old_path.file_name().ok_or("bad folder path")?;
  let new_path = PathBuf::from(&dest_parent).join(name);
  if new_path.exists() {
    return Err(format!("{} already exists.", new_path.display()));
  }
  if new_path.starts_with(&old_path) {
    return Err("A folder can't be moved inside itself.".into());
  }
  move_dir(&old_path, &new_path).map_err(err)?;
  {
    let mut conn = state.db.lock().map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    rebase_paths(&tx, &old, &new_path.to_string_lossy()).map_err(err)?;
    tx.commit().map_err(err)?;
  }
  scanner::spawn_rescan(app);
  Ok(new_path.to_string_lossy().into_owned())
}

/// Send a whole folder to the Recycle Bin and drop it (and its subfolders) from the library.
#[tauri::command(async)]
pub fn delete_folder(state: State<'_, AppState>, id: i64) -> CmdResult<()> {
  let path: String = {
    let conn = state.db.lock().map_err(err)?;
    conn.query_row("SELECT path FROM folders WHERE id = ?1", [id], |r| r.get(0)).map_err(err)?
  };
  if Path::new(&path).exists() {
    move_to_trash(Path::new(&path)).map_err(err)?;
  }
  let mut conn = state.db.lock().map_err(err)?;
  let tx = conn.transaction().map_err(err)?;
  let prefix = with_sep(&path);
  tx.execute(
    "DELETE FROM photos_fts WHERE rowid IN (SELECT p.id FROM photos p JOIN folders f ON f.id = p.folder_id
       WHERE f.path = ?1 OR substr(f.path, 1, length(?2)) = ?2)",
    params![path, prefix],
  )
  .map_err(err)?;
  tx.execute("DELETE FROM folders WHERE path = ?1 OR substr(path, 1, length(?2)) = ?2", params![path, prefix]).map_err(err)?;
  tx.commit().map_err(err)
}

// ---------------------------------------------------------------------------------------------

/// Recycle Bin on Windows; Trash on macOS via NSFileManager, which needs no Finder automation
/// permission (the trash crate's default asks Finder and triggers a permission prompt).
fn move_to_trash(path: &Path) -> Result<(), trash::Error> {
  #[cfg(target_os = "macos")]
  {
    use trash::macos::{DeleteMethod, TrashContextExtMacos};
    let mut ctx = trash::TrashContext::default();
    ctx.set_delete_method(DeleteMethod::NsFileManager);
    ctx.delete(path)
  }
  #[cfg(not(target_os = "macos"))]
  {
    trash::delete(path)
  }
}

/// Sends files to the Recycle Bin / Trash. Per file: whether it went, and (macOS) where it landed
/// in the Trash, which Edit › Undo needs to put it back.
fn trash_files(paths: &[&Path]) -> Vec<Result<Option<PathBuf>, String>> {
  #[cfg(target_os = "macos")]
  {
    paths.iter().map(|p| trash_on_mac(p)).collect()
  }
  #[cfg(not(target_os = "macos"))]
  {
    // One Recycle Bin operation for the whole selection instead of one per picture. If it fails,
    // each picture is tried on its own to report which ones failed.
    if paths.len() > 1 && trash::delete_all(paths.iter().copied()).is_ok() {
      return paths.iter().map(|_| Ok(None)).collect();
    }
    paths.iter().map(|p| trash::delete(p).map(|_| None).map_err(err)).collect()
  }
}

/// NSFileManager's trashItemAtURL (no Finder automation prompt), keeping the resulting location.
#[cfg(target_os = "macos")]
fn trash_on_mac(path: &Path) -> Result<Option<PathBuf>, String> {
  use objc2::rc::Retained;
  use objc2_foundation::{NSFileManager, NSString, NSURL};
  let mgr = NSFileManager::defaultManager();
  let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
  let mut landed: Option<Retained<NSURL>> = None;
  mgr.trashItemAtURL_resultingItemURL_error(&url, Some(&mut landed)).map_err(|e| format!("{}: {e}", path.display()))?;
  #[allow(deprecated)]
  let landed = landed.and_then(|u| u.path()).map(|p| PathBuf::from(p.to_string()));
  Ok(landed)
}

/// Puts files back from the Recycle Bin / Trash. Returns the paths that are back.
fn restore_from_trash(items: &[(String, Option<String>)], failed: &mut Vec<String>) -> Vec<String> {
  let mut back = Vec::new();
  let todo: Vec<&(String, Option<String>)> = items
    .iter()
    .filter(|(path, _)| {
      let taken = Path::new(path).exists();
      if taken {
        failed.push(format!("{path}: a file with that name is there again"));
      }
      !taken
    })
    .collect();
  #[cfg(target_os = "macos")]
  for (path, landed) in todo {
    match landed {
      Some(from) if std::fs::rename(from, path).is_ok() => back.push(path.clone()),
      _ => failed.push(format!("{path}: it is no longer in the Trash")),
    }
  }
  #[cfg(not(target_os = "macos"))]
  {
    let list = trash::os_limited::list().unwrap_or_default();
    let same = |a: &Path, b: &Path| a.to_string_lossy().eq_ignore_ascii_case(&b.to_string_lossy()) && (cfg!(windows) || a == b);
    let mut picks = Vec::new();
    for (path, _) in todo {
      // The most recent copy, if the same file was deleted more than once.
      match list.iter().filter(|it| same(&it.original_path(), Path::new(path))).max_by_key(|it| it.time_deleted) {
        Some(it) => picks.push((path.clone(), it.clone())),
        None => failed.push(format!("{path}: it is no longer in the Recycle Bin")),
      }
    }
    if trash::os_limited::restore_all(picks.iter().map(|(_, it)| it.clone())).is_err() {
      for (path, it) in &picks {
        if Path::new(path).exists() {
          continue; // the batch got this one back before it stopped
        }
        if let Err(e) = trash::os_limited::restore_all([it.clone()]) {
          failed.push(format!("{path}: {e}"));
        }
      }
    }
    for (path, _) in picks {
      if Path::new(&path).exists() {
        back.push(path);
      }
    }
  }
  back
}

fn photo_paths(state: &State<'_, AppState>, ids: &[i64]) -> CmdResult<Vec<(i64, String)>> {
  let conn = state.db.lock().map_err(err)?;
  let mut stmt = conn.prepare_cached("SELECT path FROM photos WHERE id = ?1").map_err(err)?;
  Ok(ids.iter().filter_map(|id| stmt.query_row([id], |r| r.get::<_, String>(0)).ok().map(|p| (*id, p))).collect())
}

/// Remove photo rows; returns the folders they belonged to.
fn forget_photos(conn: &Connection, ids: &[i64]) -> rusqlite::Result<Vec<i64>> {
  let mut folders = Vec::new();
  for id in ids {
    if let Ok(f) = conn.query_row("SELECT folder_id FROM photos WHERE id = ?1", [id], |r| r.get::<_, i64>(0)) {
      folders.push(f);
    }
    conn.execute("DELETE FROM photos_fts WHERE rowid = ?1", [id])?;
    conn.execute("DELETE FROM photos WHERE id = ?1", [id])?;
  }
  folders.sort_unstable();
  folders.dedup();
  Ok(folders)
}

fn ensure_folder(conn: &Connection, dir: &Path) -> rusqlite::Result<i64> {
  let path = dir.to_string_lossy();
  let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string());
  conn.execute("INSERT OR IGNORE INTO folders(path, name) VALUES (?1, ?2)", params![path, name])?;
  conn.query_row("SELECT id FROM folders WHERE path = ?1", [path], |r| r.get(0))
}

/// Rewrite folder and photo paths after a folder moved from `old` to `new`.
fn rebase_paths(conn: &Connection, old: &str, new: &str) -> rusqlite::Result<()> {
  let (old_p, new_p) = (with_sep(old), with_sep(new));
  conn.execute(
    "UPDATE folders SET path = ?2 || substr(path, length(?1) + 1) WHERE substr(path, 1, length(?1)) = ?1",
    params![old_p, new_p],
  )?;
  let new_name = Path::new(new).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
  conn.execute("UPDATE folders SET path = ?2, name = ?3 WHERE path = ?1", params![old, new, new_name])?;
  conn.execute(
    "UPDATE photos SET path = ?2 || substr(path, length(?1) + 1) WHERE substr(path, 1, length(?1)) = ?1",
    params![old_p, new_p],
  )?;
  // Folder names feed the search index.
  let ids: Vec<i64> = {
    let mut stmt = conn.prepare("SELECT id FROM photos WHERE substr(path, 1, length(?1)) = ?1")?;
    let rows = stmt.query_map([&new_p], |r| r.get(0))?;
    rows.filter_map(Result::ok).collect()
  };
  for id in ids {
    db::reindex_photo(conn, id)?;
  }
  Ok(())
}

fn with_sep(p: &str) -> String {
  let sep = std::path::MAIN_SEPARATOR;
  if p.ends_with(sep) {
    p.to_string()
  } else {
    format!("{p}{sep}")
  }
}

pub(crate) fn unique_target(dir: &Path, name: String) -> PathBuf {
  let first = dir.join(&name);
  if !first.exists() {
    return first;
  }
  let p = Path::new(&name);
  let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
  let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
  (2..).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|c| !c.exists()).unwrap()
}

/// rename(), falling back to copy + delete across drives.
fn move_file(src: &Path, dst: &Path) -> std::io::Result<()> {
  if std::fs::rename(src, dst).is_ok() {
    return Ok(());
  }
  std::fs::copy(src, dst)?;
  std::fs::remove_file(src)
}

fn move_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
  if std::fs::rename(src, dst).is_ok() {
    return Ok(());
  }
  copy_dir(src, dst)?;
  std::fs::remove_dir_all(src)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_dir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("picaluma-test-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
  }

  fn library(dir: &Path) -> Connection {
    db::open(&dir.join("library.db")).unwrap()
  }

  #[test]
  fn unique_target_appends_counter() {
    let d = temp_dir("unique");
    std::fs::write(d.join("a.jpg"), b"x").unwrap();
    std::fs::write(d.join("a (2).jpg"), b"x").unwrap();
    assert_eq!(unique_target(&d, "a.jpg".into()), d.join("a (3).jpg"));
    assert_eq!(unique_target(&d, "b.jpg".into()), d.join("b.jpg"));
  }

  #[test]
  fn rebase_paths_moves_folder_and_subfolders_keeping_ids() {
    let d = temp_dir("rebase");
    let conn = library(&d);
    let sep = std::path::MAIN_SEPARATOR;
    let old = format!("{}{sep}Trip", d.display());
    let sub = format!("{old}{sep}Day 1");
    let sibling = format!("{old} 2"); // shares the prefix text but is a different folder
    for (path, name) in [(&old, "Trip"), (&sub, "Day 1"), (&sibling, "Trip 2")] {
      conn.execute("INSERT INTO folders(path, name) VALUES (?1, ?2)", params![path, name]).unwrap();
    }
    let fid = |p: &str| conn.query_row("SELECT id FROM folders WHERE path = ?1", [p], |r| r.get::<_, i64>(0)).unwrap();
    let (f_old, f_sub, f_sib) = (fid(&old), fid(&sub), fid(&sibling));
    for (f, p) in [(f_old, format!("{old}{sep}a.jpg")), (f_sub, format!("{sub}{sep}b.jpg")), (f_sib, format!("{sibling}{sep}c.jpg"))] {
      conn.execute("INSERT INTO photos(folder_id, path, name, size, mtime) VALUES (?1, ?2, 'x', 1, 1)", params![f, p]).unwrap();
    }
    let new = format!("{}{sep}Holiday", d.display());
    rebase_paths(&conn, &old, &new).unwrap();

    let path_of = |id: i64| conn.query_row("SELECT path FROM folders WHERE id = ?1", [id], |r| r.get::<_, String>(0)).unwrap();
    assert_eq!(path_of(f_old), new);
    assert_eq!(path_of(f_sub), format!("{new}{sep}Day 1"));
    assert_eq!(path_of(f_sib), sibling, "a sibling with a similar name must not move");
    let name: String = conn.query_row("SELECT name FROM folders WHERE id = ?1", [f_old], |r| r.get(0)).unwrap();
    assert_eq!(name, "Holiday");
    let photos: Vec<String> = conn
      .prepare("SELECT path FROM photos ORDER BY id")
      .unwrap()
      .query_map([], |r| r.get(0))
      .unwrap()
      .map(Result::unwrap)
      .collect();
    assert_eq!(photos, vec![format!("{new}{sep}a.jpg"), format!("{new}{sep}Day 1{sep}b.jpg"), format!("{sibling}{sep}c.jpg")]);
  }

  #[test]
  fn forget_photos_reports_folders() {
    let d = temp_dir("forget");
    let conn = library(&d);
    conn.execute("INSERT INTO folders(path, name) VALUES ('X', 'X')", []).unwrap();
    conn.execute("INSERT INTO photos(folder_id, path, name, size, mtime) VALUES (1, 'X/a', 'a', 1, 1), (1, 'X/b', 'b', 1, 1)", []).unwrap();
    assert_eq!(forget_photos(&conn, &[1, 2]).unwrap(), vec![1]);
    let left: i64 = conn.query_row("SELECT COUNT(*) FROM photos", [], |r| r.get(0)).unwrap();
    assert_eq!(left, 0);
  }

  #[test]
  fn undo_delete_brings_back_rows_albums_and_faces() {
    let d = temp_dir("undodel");
    let mut conn = library(&d);
    let sep = std::path::MAIN_SEPARATOR;
    let dir = format!("{}{sep}Trip", d.display());
    let pic = format!("{dir}{sep}a.jpg");
    conn.execute("INSERT INTO folders(path, name) VALUES (?1, 'Trip')", [&dir]).unwrap();
    conn.execute("INSERT INTO photos(folder_id, path, name, size, mtime, starred, caption) VALUES (1, ?1, 'a.jpg', 1, 1, 1, 'beach')", [&pic]).unwrap();
    let id = conn.last_insert_rowid();
    conn.execute("INSERT INTO albums(name) VALUES ('Best')", []).unwrap();
    conn.execute("INSERT INTO album_photos(album_id, photo_id, pos) VALUES (1, ?1, 0)", [id]).unwrap();
    conn.execute("INSERT INTO people(name) VALUES ('Sam')", []).unwrap();
    conn.execute("INSERT INTO faces(photo_id, x, y, w, h, person_id, state) VALUES (?1, 0, 0, 1, 1, 1, 1)", [id]).unwrap();

    let tx = conn.transaction().unwrap();
    stash_deleted(&tx, 7, &[(id, pic.clone(), None)]).unwrap();
    forget_photos(&tx, &[id]).unwrap();
    tx.commit().unwrap();
    let count = |c: &Connection, t: &str| c.query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get::<_, i64>(0)).unwrap();
    assert_eq!((count(&conn, "photos"), count(&conn, "album_photos"), count(&conn, "faces")), (0, 0, 0));

    restore_rows(&conn, 7, &[pic.clone()]).unwrap();
    let (back, star, cap): (i64, i64, String) =
      conn.query_row("SELECT id, starred, caption FROM photos WHERE path = ?1", [&pic], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
    assert_eq!((back, star, cap.as_str()), (id, 1, "beach"));
    assert_eq!(count(&conn, "album_photos"), 1);
    let person: i64 = conn.query_row("SELECT person_id FROM faces WHERE photo_id = ?1", [id], |r| r.get(0)).unwrap();
    assert_eq!(person, 1);
  }

  #[test]
  fn moved_picture_takes_its_ini_record_along() {
    let d = temp_dir("moveini");
    std::fs::create_dir_all(d.join("a")).unwrap();
    std::fs::create_dir_all(d.join("b")).unwrap();
    crate::folderini::save_edits(&d.join("a/p.jpg"), r#"[{"op":"sepia"}]"#).unwrap();
    crate::folderini::move_entry(&d.join("a/p.jpg"), &d.join("b/p (2).jpg")).unwrap();
    assert!(crate::folderini::folder_edits(&d.join("a")).is_empty());
    assert_eq!(crate::folderini::folder_edits(&d.join("b")).get("p (2).jpg").map(String::as_str), Some(r#"[{"op":"sepia"}]"#));
  }

  #[test]
  fn move_file_and_dir() {
    let d = temp_dir("move");
    std::fs::create_dir_all(d.join("src/inner")).unwrap();
    std::fs::write(d.join("src/inner/p.jpg"), b"pic").unwrap();
    move_dir(&d.join("src"), &d.join("dst")).unwrap();
    assert!(d.join("dst/inner/p.jpg").exists() && !d.join("src").exists());
    move_file(&d.join("dst/inner/p.jpg"), &d.join("q.jpg")).unwrap();
    assert_eq!(std::fs::read(d.join("q.jpg")).unwrap(), b"pic");
  }
}

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
  std::fs::create_dir_all(dst)?;
  for entry in std::fs::read_dir(src)? {
    let entry = entry?;
    let to = dst.join(entry.file_name());
    if entry.file_type()?.is_dir() {
      copy_dir(&entry.path(), &to)?;
    } else {
      std::fs::copy(entry.path(), to)?;
    }
  }
  Ok(())
}
