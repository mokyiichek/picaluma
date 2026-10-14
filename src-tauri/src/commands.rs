use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Instant;

use base64::Engine;
use rusqlite::params;
use serde::Serialize;
use tauri::{AppHandle, State};

use crate::db;
use crate::scanner::{self, ScanProgress};
use crate::AppState;

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
  e.to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderDto {
  id: i64,
  name: String,
  path: String,
  description: String,
  date_min: i64,
  date_max: i64,
  updated: i64,
  bytes: i64,
  photos: Vec<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
  folders: Vec<FolderDto>,
  starred: Vec<i64>,
  geotagged: Vec<i64>,
  edits: Vec<(i64, String)>,
  total_photos: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootDto {
  path: String,
  excluded: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoDto {
  id: i64,
  folder_id: i64,
  folder_name: String,
  path: String,
  name: String,
  size: i64,
  mtime: i64,
  taken: Option<i64>,
  width: i64,
  height: i64,
  exif: Vec<(String, String)>,
  caption: String,
  starred: bool,
  edits: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
  ids: Vec<i64>,
  seconds: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PicasaScanlist {
  found: bool,
  include: Vec<String>,
  exclude: Vec<String>,
}

/// Everything the library view needs in one round-trip: folders (newest first) with photo ids.
#[tauri::command]
pub fn library_snapshot(state: State<'_, AppState>) -> CmdResult<Snapshot> {
  let conn = state.db.lock().map_err(err)?;
  let mut folders: Vec<FolderDto> = {
    let mut stmt = conn
      .prepare(
        "SELECT id, name, path, description, date_min, date_max, updated, bytes FROM folders
         WHERE photo_count > 0 ORDER BY updated DESC, name",
      )
      .map_err(err)?;
    let rows = stmt
      .query_map([], |r| {
        Ok(FolderDto {
          id: r.get(0)?,
          name: r.get(1)?,
          path: r.get(2)?,
          description: r.get(3)?,
          date_min: r.get(4)?,
          date_max: r.get(5)?,
          updated: r.get(6)?,
          bytes: r.get(7)?,
          photos: Vec::new(),
        })
      })
      .map_err(err)?;
    rows.filter_map(Result::ok).collect()
  };
  let index: HashMap<i64, usize> = folders.iter().enumerate().map(|(i, f)| (f.id, i)).collect();

  let mut starred = Vec::new();
  let mut geotagged = Vec::new();
  let mut edits = Vec::new();
  let mut total = 0i64;
  let mut stmt = conn
    .prepare("SELECT id, folder_id, starred, has_gps, edits FROM photos ORDER BY folder_id, COALESCE(taken, mtime), name")
    .map_err(err)?;
  let mut rows = stmt.query([]).map_err(err)?;
  while let Some(r) = rows.next().map_err(err)? {
    let id: i64 = r.get(0).map_err(err)?;
    let folder_id: i64 = r.get(1).map_err(err)?;
    if let Some(&i) = index.get(&folder_id) {
      folders[i].photos.push(id);
      total += 1;
    }
    if r.get::<_, i64>(2).map_err(err)? != 0 {
      starred.push(id);
    }
    if r.get::<_, i64>(3).map_err(err)? != 0 {
      geotagged.push(id);
    }
    let e: String = r.get(4).map_err(err)?;
    if !e.is_empty() {
      edits.push((id, e));
    }
  }
  Ok(Snapshot { folders, starred, geotagged, edits, total_photos: total })
}

#[tauri::command]
pub fn list_roots(state: State<'_, AppState>) -> CmdResult<Vec<RootDto>> {
  let conn = state.db.lock().map_err(err)?;
  let mut stmt = conn.prepare("SELECT path, excluded FROM roots ORDER BY excluded, path").map_err(err)?;
  let rows = stmt
    .query_map([], |r| Ok(RootDto { path: r.get(0)?, excluded: r.get::<_, i64>(1)? != 0 }))
    .map_err(err)?;
  Ok(rows.filter_map(Result::ok).collect())
}

#[tauri::command]
pub fn add_root(app: AppHandle, state: State<'_, AppState>, path: String, excluded: Option<bool>) -> CmdResult<()> {
  {
    let conn = state.db.lock().map_err(err)?;
    conn
      .execute(
        "INSERT INTO roots(path, excluded) VALUES (?1, ?2) ON CONFLICT(path) DO UPDATE SET excluded = excluded.excluded",
        params![path, excluded.unwrap_or(false) as i64],
      )
      .map_err(err)?;
  }
  scanner::spawn_rescan(app);
  Ok(())
}

#[tauri::command]
pub fn remove_root(app: AppHandle, state: State<'_, AppState>, path: String) -> CmdResult<()> {
  {
    let conn = state.db.lock().map_err(err)?;
    conn.execute("DELETE FROM roots WHERE path = ?1", [&path]).map_err(err)?;
  }
  scanner::spawn_rescan(app);
  Ok(())
}

#[tauri::command]
pub fn rescan(app: AppHandle) {
  scanner::spawn_rescan(app);
}

#[tauri::command]
pub fn scan_status(app: AppHandle) -> ScanProgress {
  ScanProgress { scanning: scanner::is_scanning(&app), folders_seen: 0, current: String::new() }
}

fn picasa_scanlist_path() -> Option<PathBuf> {
  // Picasa keeps "+path" (scan always) and "path" (excluded) lines in db3/scanlist.txt.
  // Its data dir is configurable (AppLocalDataPath); check the common locations.
  let mut candidates = vec![PathBuf::from(r"C:\Picasa2\Google\Picasa2\db3\scanlist.txt")];
  if let Ok(local) = std::env::var("LOCALAPPDATA") {
    candidates.push(PathBuf::from(local).join(r"Google\Picasa2\db3\scanlist.txt"));
  }
  candidates.into_iter().find(|p| p.exists())
}

#[tauri::command]
pub fn picasa_scanlist() -> PicasaScanlist {
  let Some(path) = picasa_scanlist_path() else {
    return PicasaScanlist { found: false, include: vec![], exclude: vec![] };
  };
  let text = std::fs::read_to_string(path).unwrap_or_default();
  let mut include = Vec::new();
  let mut exclude = Vec::new();
  for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
    match line.strip_prefix('+') {
      Some(p) => include.push(p.to_string()),
      None => exclude.push(line.to_string()),
    }
  }
  PicasaScanlist { found: true, include, exclude }
}

#[tauri::command]
pub fn import_picasa_scanlist(app: AppHandle, state: State<'_, AppState>) -> CmdResult<usize> {
  let list = picasa_scanlist();
  {
    let conn = state.db.lock().map_err(err)?;
    for p in &list.include {
      conn
        .execute("INSERT INTO roots(path, excluded) VALUES (?1, 0) ON CONFLICT(path) DO UPDATE SET excluded = 0", [p])
        .map_err(err)?;
    }
    for p in &list.exclude {
      conn
        .execute("INSERT INTO roots(path, excluded) VALUES (?1, 1) ON CONFLICT(path) DO UPDATE SET excluded = 1", [p])
        .map_err(err)?;
    }
  }
  scanner::spawn_rescan(app);
  Ok(list.include.len())
}

/// Prefix full-text search over file name, folder name/description, caption, tags and camera.
#[tauri::command]
pub fn search(state: State<'_, AppState>, query: String) -> CmdResult<SearchResult> {
  let started = Instant::now();
  let fts = to_fts_query(&query);
  if fts.is_empty() {
    return Ok(SearchResult { ids: vec![], seconds: 0.0 });
  }
  let conn = state.db.lock().map_err(err)?;
  let mut stmt = conn.prepare_cached("SELECT rowid FROM photos_fts WHERE photos_fts MATCH ?1").map_err(err)?;
  let ids: Vec<i64> = stmt.query_map([&fts], |r| r.get(0)).map_err(err)?.filter_map(Result::ok).collect();
  Ok(SearchResult { ids, seconds: started.elapsed().as_secs_f64() })
}

fn to_fts_query(q: &str) -> String {
  q.split(|c: char| c.is_whitespace() || c == '-' || c == '_' || c == '.')
    .map(|t| t.chars().filter(|c| c.is_alphanumeric()).collect::<String>())
    .filter(|t| !t.is_empty())
    .map(|t| format!("\"{t}\"*"))
    .collect::<Vec<_>>()
    .join(" ")
}

#[tauri::command]
pub fn get_photo(state: State<'_, AppState>, id: i64) -> CmdResult<PhotoDto> {
  let conn = state.db.lock().map_err(err)?;
  conn
    .query_row(
      "SELECT p.id, p.folder_id, f.name, p.path, p.name, p.size, p.mtime, p.taken, p.width, p.height,
              p.exif, p.caption, p.starred, p.edits
       FROM photos p JOIN folders f ON f.id = p.folder_id WHERE p.id = ?1",
      [id],
      |r| {
        let exif: String = r.get(10)?;
        Ok(PhotoDto {
          id: r.get(0)?,
          folder_id: r.get(1)?,
          folder_name: r.get(2)?,
          path: r.get(3)?,
          name: r.get(4)?,
          size: r.get(5)?,
          mtime: r.get(6)?,
          taken: r.get(7)?,
          width: r.get(8)?,
          height: r.get(9)?,
          exif: serde_json::from_str(&exif).unwrap_or_default(),
          caption: r.get(11)?,
          starred: r.get::<_, i64>(12)? != 0,
          edits: r.get(13)?,
        })
      },
    )
    .map_err(err)
}

#[tauri::command]
pub fn set_star(state: State<'_, AppState>, ids: Vec<i64>, starred: bool) -> CmdResult<()> {
  let mut conn = state.db.lock().map_err(err)?;
  let tx = conn.transaction().map_err(err)?;
  for id in ids {
    tx.execute("UPDATE photos SET starred = ?1 WHERE id = ?2", params![starred as i64, id]).map_err(err)?;
  }
  tx.commit().map_err(err)
}

#[tauri::command]
pub fn set_caption(state: State<'_, AppState>, id: i64, caption: String) -> CmdResult<()> {
  let conn = state.db.lock().map_err(err)?;
  conn.execute("UPDATE photos SET caption = ?1 WHERE id = ?2", params![caption, id]).map_err(err)?;
  db::reindex_photo(&conn, id).map_err(err)
}

#[tauri::command]
pub fn set_folder_description(state: State<'_, AppState>, id: i64, description: String) -> CmdResult<()> {
  let mut conn = state.db.lock().map_err(err)?;
  let tx = conn.transaction().map_err(err)?;
  tx.execute("UPDATE folders SET description = ?1 WHERE id = ?2", params![description, id]).map_err(err)?;
  let ids: Vec<i64> = {
    let mut stmt = tx.prepare("SELECT id FROM photos WHERE folder_id = ?1").map_err(err)?;
    let rows = stmt.query_map([id], |r| r.get(0)).map_err(err)?;
    rows.filter_map(Result::ok).collect()
  };
  for pid in ids {
    db::reindex_photo(&tx, pid).map_err(err)?;
  }
  tx.commit().map_err(err)
}

/// Edits are stored as a JSON stack and rendered non-destructively; originals are never touched.
#[tauri::command]
pub fn set_edits(state: State<'_, AppState>, id: i64, edits: String) -> CmdResult<()> {
  let conn = state.db.lock().map_err(err)?;
  conn.execute("UPDATE photos SET edits = ?1 WHERE id = ?2", params![edits, id]).map_err(err)?;
  Ok(())
}

/// Lets the UI write diagnostics into the app log (visible in `tauri dev` output).
#[tauri::command]
pub fn ui_log(message: String) {
  log::info!("[ui] {message}");
}

/// Writes a rendered (edited) copy produced by the frontend canvas.
#[tauri::command]
pub fn export_picture(path: String, data_base64: String) -> CmdResult<()> {
  let bytes = base64::engine::general_purpose::STANDARD.decode(data_base64.as_bytes()).map_err(err)?;
  std::fs::write(path, bytes).map_err(err)
}
