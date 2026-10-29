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
}

/// Move pictures to the Recycle Bin / Trash (or, with `permanent`, delete them outright —
/// Shift+Delete) and drop them from the library.
#[tauri::command(async)]
pub fn delete_photos(state: State<'_, AppState>, ids: Vec<i64>, permanent: Option<bool>) -> CmdResult<OpResult> {
  let permanent = permanent.unwrap_or(false);
  let photos = photo_paths(&state, &ids)?;
  let mut res = OpResult::default();
  let mut gone = Vec::new();
  // One Recycle Bin operation for the whole selection instead of one per picture. If it fails,
  // each picture is tried on its own to report which ones failed.
  let batch_ok = !permanent && photos.len() > 1 && move_all_to_trash(photos.iter().map(|(_, p)| Path::new(p))).is_ok();
  for (id, path) in photos {
    let removed = if batch_ok {
      true
    } else if permanent {
      std::fs::remove_file(&path).is_ok()
    } else {
      move_to_trash(Path::new(&path)).is_ok()
    };
    if !Path::new(&path).exists() || removed {
      gone.push(id);
      res.done += 1;
    } else {
      res.failed.push(path);
    }
  }
  let mut conn = state.db.lock().map_err(err)?;
  let tx = conn.transaction().map_err(err)?;
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
  let mut moved: Vec<(i64, PathBuf)> = Vec::new();
  for (id, path) in photos {
    let src = PathBuf::from(&path);
    if src.parent() == Some(dest_dir.as_path()) {
      continue; // already there
    }
    let target = unique_target(&dest_dir, src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
    let ok = if copy { std::fs::copy(&src, &target).map(|_| ()) } else { move_file(&src, &target) };
    match ok {
      Ok(()) => {
        res.done += 1;
        if !copy {
          moved.push((id, target));
        }
      }
      Err(e) => res.failed.push(format!("{path}: {e}")),
    }
  }
  if !moved.is_empty() {
    let mut conn = state.db.lock().map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    let dest_folder = ensure_folder(&tx, &dest_dir).map_err(err)?;
    let mut touched = vec![dest_folder];
    for (id, target) in &moved {
      let old: i64 = tx.query_row("SELECT folder_id FROM photos WHERE id = ?1", [id], |r| r.get(0)).map_err(err)?;
      touched.push(old);
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
  // Copies (and moves into folders outside the watched roots) are reconciled by a rescan.
  scanner::spawn_rescan(app);
  Ok(res)
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

fn move_all_to_trash<'a>(paths: impl IntoIterator<Item = &'a Path>) -> Result<(), trash::Error> {
  #[cfg(target_os = "macos")]
  {
    use trash::macos::{DeleteMethod, TrashContextExtMacos};
    let mut ctx = trash::TrashContext::default();
    ctx.set_delete_method(DeleteMethod::NsFileManager);
    ctx.delete_all(paths)
  }
  #[cfg(not(target_os = "macos"))]
  {
    trash::delete_all(paths)
  }
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
