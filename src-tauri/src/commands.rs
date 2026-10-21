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
  /// Sort Folder By: "" (date taken), "modified", "name" or "size".
  sort: String,
  photos: Vec<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumDto {
  id: i64,
  name: String,
  description: String,
  created: i64,
  photos: Vec<i64>,
  /// Sort Album By: "" (as arranged), "date", "modified", "name" or "size".
  sort: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
  folders: Vec<FolderDto>,
  albums: Vec<AlbumDto>,
  starred: Vec<i64>,
  geotagged: Vec<i64>,
  edits: Vec<(i64, String)>,
  total_photos: i64,
  library_id: String,
  /// Videos (shown with a play badge and opened in the player).
  videos: Vec<i64>,
  /// Picture › Hide: hidden pictures (shown with View › Hidden Pictures).
  hidden: Vec<i64>,
  /// Albums › Recently Updated: pictures whose file changed in the last 30 days.
  recent: Vec<i64>,
  /// People albums, the photos with faces (Faces filter) and the number of unnamed faces.
  people: Vec<crate::people::PersonDto>,
  faced: Vec<i64>,
  unnamed: i64,
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
#[tauri::command(async)]
pub fn library_snapshot(state: State<'_, AppState>) -> CmdResult<Snapshot> {
  let conn = state.db.lock().map_err(err)?;
  let mut folders: Vec<FolderDto> = {
    let mut stmt = conn
      .prepare(
        "SELECT id, name, path, description, date_min, date_max, updated, bytes, sort FROM folders
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
          sort: r.get(8)?,
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
  let mut videos = Vec::new();
  let mut hidden = Vec::new();
  let mut recent = Vec::new();
  let recent_since = chrono::Local::now().naive_local().and_utc().timestamp() - 30 * 86_400;
  let mut stmt = conn
    .prepare(
      "SELECT p.id, p.folder_id, p.starred, p.has_gps, p.edits, p.path, p.hidden, p.mtime FROM photos p JOIN folders f ON f.id = p.folder_id
       ORDER BY p.folder_id,
         CASE WHEN f.sort = 'name' THEN p.name END COLLATE NOCASE,
         CASE WHEN f.sort = 'size' THEN p.size END DESC,
         CASE WHEN f.sort = 'modified' THEN p.mtime END DESC,
         COALESCE(p.taken, p.mtime), p.name",
    )
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
    let path: String = r.get(5).map_err(err)?;
    if crate::formats::is_video(&path) {
      videos.push(id);
    }
    if r.get::<_, i64>(6).map_err(err)? != 0 {
      hidden.push(id);
    }
    if r.get::<_, i64>(7).map_err(err)? >= recent_since {
      recent.push(id);
    }
    let e: String = r.get(4).map_err(err)?;
    if !e.is_empty() {
      edits.push((id, e));
    }
  }
  drop(rows);
  drop(stmt);
  let library_id = db::library_id(&conn);
  let albums = load_albums(&conn).map_err(err)?;
  let (people, faced, unnamed) = crate::people::snapshot(&conn).map_err(err)?;
  Ok(Snapshot { folders, albums, starred, geotagged, edits, total_photos: total, library_id, videos, hidden, recent, people, faced, unnamed })
}

fn load_albums(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<AlbumDto>> {
  let mut albums: Vec<AlbumDto> = {
    let mut stmt = conn.prepare("SELECT id, name, description, created, sort FROM albums ORDER BY created DESC, id DESC")?;
    let rows = stmt.query_map([], |r| {
      Ok(AlbumDto { id: r.get(0)?, name: r.get(1)?, description: r.get(2)?, created: r.get(3)?, sort: r.get(4)?, photos: Vec::new() })
    })?;
    rows.filter_map(Result::ok).collect()
  };
  let index: HashMap<i64, usize> = albums.iter().enumerate().map(|(i, a)| (a.id, i)).collect();
  // Sort Album By: the album's own order (as arranged) unless a sort was chosen.
  let mut stmt = conn.prepare(
    "SELECT ap.album_id, ap.photo_id FROM album_photos ap JOIN albums a ON a.id = ap.album_id JOIN photos p ON p.id = ap.photo_id
     ORDER BY ap.album_id,
       CASE WHEN a.sort = 'name' THEN p.name END COLLATE NOCASE,
       CASE WHEN a.sort = 'size' THEN p.size END DESC,
       CASE WHEN a.sort = 'modified' THEN p.mtime END DESC,
       CASE WHEN a.sort = 'date' THEN COALESCE(p.taken, p.mtime) END,
       ap.pos",
  )?;
  let mut rows = stmt.query([])?;
  while let Some(r) = rows.next()? {
    if let Some(&i) = index.get(&r.get::<_, i64>(0)?) {
      albums[i].photos.push(r.get(1)?);
    }
  }
  Ok(albums)
}

/// Creates an album, optionally seeded with photos; returns its id.
#[tauri::command(async)]
pub fn create_album(state: State<'_, AppState>, name: String, ids: Vec<i64>) -> CmdResult<i64> {
  let mut conn = state.db.lock().map_err(err)?;
  let tx = conn.transaction().map_err(err)?;
  tx.execute("INSERT INTO albums(name) VALUES (?1)", [name.trim()]).map_err(err)?;
  let id = tx.last_insert_rowid();
  append_to_album(&tx, id, &ids).map_err(err)?;
  tx.commit().map_err(err)?;
  Ok(id)
}

#[tauri::command(async)]
pub fn album_add(state: State<'_, AppState>, id: i64, ids: Vec<i64>) -> CmdResult<()> {
  let mut conn = state.db.lock().map_err(err)?;
  let tx = conn.transaction().map_err(err)?;
  append_to_album(&tx, id, &ids).map_err(err)?;
  tx.commit().map_err(err)
}

fn append_to_album(conn: &rusqlite::Connection, album: i64, ids: &[i64]) -> rusqlite::Result<()> {
  let mut pos: i64 = conn.query_row("SELECT COALESCE(MAX(pos), 0) FROM album_photos WHERE album_id = ?1", [album], |r| r.get(0))?;
  let mut stmt = conn.prepare_cached("INSERT OR IGNORE INTO album_photos(album_id, photo_id, pos) VALUES (?1, ?2, ?3)")?;
  for id in ids {
    pos += 1;
    stmt.execute(params![album, id, pos])?;
  }
  Ok(())
}

#[tauri::command(async)]
pub fn album_remove(state: State<'_, AppState>, id: i64, ids: Vec<i64>) -> CmdResult<()> {
  let mut conn = state.db.lock().map_err(err)?;
  let tx = conn.transaction().map_err(err)?;
  for p in ids {
    tx.execute("DELETE FROM album_photos WHERE album_id = ?1 AND photo_id = ?2", params![id, p]).map_err(err)?;
  }
  tx.commit().map_err(err)
}

#[tauri::command(async)]
pub fn update_album(state: State<'_, AppState>, id: i64, name: Option<String>, description: Option<String>) -> CmdResult<()> {
  let conn = state.db.lock().map_err(err)?;
  if let Some(n) = name {
    conn.execute("UPDATE albums SET name = ?1 WHERE id = ?2", params![n.trim(), id]).map_err(err)?;
  }
  if let Some(d) = description {
    conn.execute("UPDATE albums SET description = ?1 WHERE id = ?2", params![d, id]).map_err(err)?;
  }
  Ok(())
}

/// Deletes the album only; the photos stay in their folders.
#[tauri::command(async)]
pub fn delete_album(state: State<'_, AppState>, id: i64) -> CmdResult<()> {
  let conn = state.db.lock().map_err(err)?;
  conn.execute("DELETE FROM albums WHERE id = ?1", [id]).map_err(err)?;
  Ok(())
}

#[tauri::command(async)]
pub fn list_roots(state: State<'_, AppState>) -> CmdResult<Vec<RootDto>> {
  let conn = state.db.lock().map_err(err)?;
  let mut stmt = conn.prepare("SELECT path, excluded FROM roots ORDER BY excluded, path").map_err(err)?;
  let rows = stmt
    .query_map([], |r| Ok(RootDto { path: r.get(0)?, excluded: r.get::<_, i64>(1)? != 0 }))
    .map_err(err)?;
  Ok(rows.filter_map(Result::ok).collect())
}

#[tauri::command(async)]
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

#[tauri::command(async)]
pub fn remove_root(app: AppHandle, state: State<'_, AppState>, path: String) -> CmdResult<()> {
  {
    let conn = state.db.lock().map_err(err)?;
    conn.execute("DELETE FROM roots WHERE path = ?1", [&path]).map_err(err)?;
  }
  scanner::spawn_rescan(app);
  Ok(())
}

#[tauri::command(async)]
pub fn rescan(app: AppHandle) {
  scanner::spawn_rescan(app);
}

#[tauri::command(async)]
pub fn scan_status(app: AppHandle) -> ScanProgress {
  ScanProgress { scanning: scanner::is_scanning(&app), ..Default::default() }
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

#[tauri::command(async)]
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

#[tauri::command(async)]
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
#[tauri::command(async)]
pub fn search(state: State<'_, AppState>, query: String) -> CmdResult<SearchResult> {
  let started = Instant::now();
  let fts = to_fts_query(&query);
  if fts.is_empty() {
    return Ok(SearchResult { ids: vec![], seconds: 0.0 });
  }
  let conn = state.db.lock().map_err(err)?;
  let mut stmt = conn.prepare_cached("SELECT rowid FROM photos_fts WHERE photos_fts MATCH ?1").map_err(err)?;
  let mut ids: Vec<i64> = stmt.query_map([&fts], |r| r.get(0)).map_err(err)?.filter_map(Result::ok).collect();
  // Typing a person's name finds the pictures they're tagged in.
  let tagged = crate::people::search(&conn, &query);
  if !tagged.is_empty() {
    let seen: std::collections::HashSet<i64> = ids.iter().copied().collect();
    ids.extend(tagged.into_iter().filter(|i| !seen.contains(i)));
  }
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

#[tauri::command(async)]
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

#[tauri::command(async)]
pub fn set_star(state: State<'_, AppState>, ids: Vec<i64>, starred: bool) -> CmdResult<()> {
  let mut conn = state.db.lock().map_err(err)?;
  let tx = conn.transaction().map_err(err)?;
  for id in ids {
    tx.execute("UPDATE photos SET starred = ?1 WHERE id = ?2", params![starred as i64, id]).map_err(err)?;
  }
  tx.commit().map_err(err)
}

#[tauri::command(async)]
pub fn set_caption(state: State<'_, AppState>, id: i64, caption: String) -> CmdResult<()> {
  let conn = state.db.lock().map_err(err)?;
  conn.execute("UPDATE photos SET caption = ?1 WHERE id = ?2", params![caption, id]).map_err(err)?;
  db::reindex_photo(&conn, id).map_err(err)
}

#[tauri::command(async)]
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
#[tauri::command(async)]
pub fn set_edits(state: State<'_, AppState>, id: i64, edits: String) -> CmdResult<()> {
  let conn = state.db.lock().map_err(err)?;
  conn.execute("UPDATE photos SET edits = ?1 WHERE id = ?2", params![edits, id]).map_err(err)?;
  Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
  tag: String,
  count: i64,
}

/// Tags are stored comma-separated in `photos.tags` and indexed by FTS, so search finds them.
#[tauri::command(async)]
pub fn set_tags(state: State<'_, AppState>, ids: Vec<i64>, add: Vec<String>, remove: Vec<String>) -> CmdResult<()> {
  let mut conn = state.db.lock().map_err(err)?;
  let tx = conn.transaction().map_err(err)?;
  for id in ids {
    let current: String = tx.query_row("SELECT tags FROM photos WHERE id = ?1", [id], |r| r.get(0)).map_err(err)?;
    let mut tags: Vec<String> = current.split(',').map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect();
    tags.retain(|t| !remove.iter().any(|r| r.eq_ignore_ascii_case(t)));
    for a in &add {
      let a = a.trim();
      if !a.is_empty() && !tags.iter().any(|t| t.eq_ignore_ascii_case(a)) {
        tags.push(a.to_string());
      }
    }
    tx.execute("UPDATE photos SET tags = ?1 WHERE id = ?2", params![tags.join(", "), id]).map_err(err)?;
    db::reindex_photo(&tx, id).map_err(err)?;
  }
  tx.commit().map_err(err)
}

#[tauri::command(async)]
pub fn get_tags(state: State<'_, AppState>, ids: Vec<i64>) -> CmdResult<Vec<TagCount>> {
  let conn = state.db.lock().map_err(err)?;
  let mut counts: HashMap<String, i64> = HashMap::new();
  for id in ids {
    let tags: String = conn.query_row("SELECT tags FROM photos WHERE id = ?1", [id], |r| r.get(0)).unwrap_or_default();
    for t in tags.split(',').map(str::trim).filter(|t| !t.is_empty()) {
      *counts.entry(t.to_string()).or_default() += 1;
    }
  }
  let mut out: Vec<TagCount> = counts.into_iter().map(|(tag, count)| TagCount { tag, count }).collect();
  out.sort_by(|a, b| a.tag.to_lowercase().cmp(&b.tag.to_lowercase()));
  Ok(out)
}

/// Search-box suggestions: tags and folder names starting with the typed prefix, with counts.
#[tauri::command(async)]
pub fn suggest(state: State<'_, AppState>, prefix: String) -> CmdResult<Vec<TagCount>> {
  let p = prefix.trim().to_lowercase();
  if p.is_empty() {
    return Ok(vec![]);
  }
  let conn = state.db.lock().map_err(err)?;
  let mut counts: HashMap<String, i64> = HashMap::new();
  let mut stmt = conn.prepare_cached("SELECT tags FROM photos WHERE tags != ''").map_err(err)?;
  let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
  for tags in rows.filter_map(Result::ok) {
    for t in tags.split(',').map(str::trim).filter(|t| t.to_lowercase().starts_with(&p)) {
      *counts.entry(t.to_string()).or_default() += 1;
    }
  }
  let mut out: Vec<TagCount> = counts.into_iter().map(|(tag, count)| TagCount { tag, count }).collect();
  out.sort_by(|a, b| b.count.cmp(&a.count).then(a.tag.cmp(&b.tag)));
  out.truncate(8);
  Ok(out)
}

/// "Open File": hand the photo to the system's default viewer/editor.
#[tauri::command(async)]
pub fn open_in_default_app(app: AppHandle, path: String) -> CmdResult<()> {
  use tauri_plugin_opener::OpenerExt;
  app.opener().open_path(path, None::<&str>).map_err(err)
}

/// Folder › Remove from Picaluma: exclude the folder from future scans and drop it now.
#[tauri::command(async)]
pub fn exclude_folder(app: AppHandle, state: State<'_, AppState>, path: String) -> CmdResult<()> {
  {
    let conn = state.db.lock().map_err(err)?;
    conn
      .execute("INSERT INTO roots(path, excluded) VALUES (?1, 1) ON CONFLICT(path) DO UPDATE SET excluded = 1", [&path])
      .map_err(err)?;
    conn
      .execute("DELETE FROM photos_fts WHERE rowid IN (SELECT p.id FROM photos p JOIN folders f ON f.id = p.folder_id WHERE f.path = ?1)", [&path])
      .map_err(err)?;
    conn.execute("DELETE FROM folders WHERE path = ?1", [&path]).map_err(err)?;
  }
  scanner::spawn_rescan(app);
  Ok(())
}

/// Lets the UI write diagnostics into the app log (visible in `tauri dev` output).
#[tauri::command(async)]
pub fn ui_log(message: String) {
  log::info!("[ui] {message}");
}

/// Writes a rendered (edited) copy produced by the frontend canvas and returns the path used.
#[tauri::command(async)]
pub fn export_picture(path: String, data_base64: String) -> CmdResult<String> {
  let bytes = base64::engine::general_purpose::STANDARD.decode(data_base64.as_bytes()).map_err(err)?;
  // Never overwrite: "beach.jpg" becomes "beach (2).jpg" if the name is taken.
  let path = PathBuf::from(path);
  let dir = path.parent().map(PathBuf::from).unwrap_or_default();
  std::fs::create_dir_all(&dir).map_err(err)?;
  let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
  let target = crate::fileops::unique_target(&dir, name);
  std::fs::write(&target, bytes).map_err(err)?;
  Ok(target.to_string_lossy().into_owned())
}

/// The user opened a folder: list and index it now, ahead of the running scan.
#[tauri::command(async)]
pub fn prioritize_folder(app: AppHandle, id: i64) {
  if id <= 0 {
    return; // albums aren't folders on disk
  }
  crate::people::prioritize(id);
  std::thread::spawn(move || scanner::scan_folder_now(&app, id));
}

/// Folder › Sort Folder By / Album › Sort Album By. `id` < 0 is an album (as in the UI).
#[tauri::command(async)]
pub fn set_sort(state: State<'_, AppState>, id: i64, sort: String) -> CmdResult<()> {
  let allowed = ["", "date", "modified", "name", "size"];
  if !allowed.contains(&sort.as_str()) {
    return Err(format!("unknown sort {sort}"));
  }
  let conn = state.db.lock().map_err(err)?;
  if id < 0 {
    conn.execute("UPDATE albums SET sort = ?1 WHERE id = ?2", params![sort, -id]).map_err(err)?;
  } else {
    let sort = if sort == "date" { "" } else { sort.as_str() };
    conn.execute("UPDATE folders SET sort = ?1 WHERE id = ?2", params![sort, id]).map_err(err)?;
  }
  Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DateFilter {
  ids: Vec<i64>,
  /// True when `ids` lists the photos to hide (older ones) because that list is shorter.
  exclude: bool,
}

/// Toolbar › Filters date slider: photos taken (or, without EXIF, modified) since `since`.
/// Whichever list is shorter is returned, so a large library never sends 700k ids.
#[tauri::command(async)]
pub fn photos_since(state: State<'_, AppState>, since: i64) -> CmdResult<DateFilter> {
  let conn = state.db.lock().map_err(err)?;
  let total: i64 = conn.query_row("SELECT COUNT(*) FROM photos", [], |r| r.get(0)).map_err(err)?;
  let newer: i64 = conn
    .query_row("SELECT COUNT(*) FROM photos WHERE COALESCE(taken, mtime) >= ?1", [since], |r| r.get(0))
    .map_err(err)?;
  let exclude = newer * 2 > total;
  let sql = if exclude {
    "SELECT id FROM photos WHERE COALESCE(taken, mtime) < ?1"
  } else {
    "SELECT id FROM photos WHERE COALESCE(taken, mtime) >= ?1"
  };
  let mut stmt = conn.prepare(sql).map_err(err)?;
  let ids = stmt.query_map([since], |r| r.get(0)).map_err(err)?.filter_map(Result::ok).collect();
  Ok(DateFilter { ids, exclude })
}

/// Picture › Hide / Unhide.
#[tauri::command(async)]
pub fn set_hidden(state: State<'_, AppState>, ids: Vec<i64>, hidden: bool) -> CmdResult<()> {
  let mut conn = state.db.lock().map_err(err)?;
  let tx = conn.transaction().map_err(err)?;
  for id in ids {
    tx.execute("UPDATE photos SET hidden = ?1 WHERE id = ?2", params![hidden as i64, id]).map_err(err)?;
  }
  tx.commit().map_err(err)
}

/// Places: [id, latitude, longitude] of geotagged pictures — the given ones, or all.
#[tauri::command(async)]
pub fn places(state: State<'_, AppState>, ids: Option<Vec<i64>>) -> CmdResult<Vec<(i64, f64, f64)>> {
  let conn = state.db.lock().map_err(err)?;
  let mut out = Vec::new();
  match ids {
    Some(ids) => {
      let mut stmt = conn.prepare_cached("SELECT lat, lon FROM photos WHERE id = ?1 AND lat IS NOT NULL").map_err(err)?;
      for id in ids {
        if let Ok((lat, lon)) = stmt.query_row([id], |r| Ok((r.get(0)?, r.get(1)?))) {
          out.push((id, lat, lon));
        }
      }
    }
    None => {
      let mut stmt = conn.prepare("SELECT id, lat, lon FROM photos WHERE lat IS NOT NULL AND hidden = 0").map_err(err)?;
      let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(err)?;
      out.extend(rows.filter_map(Result::ok));
    }
  }
  Ok(out)
}

