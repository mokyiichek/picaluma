use std::path::{Path, PathBuf};

use rusqlite::Connection;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS roots (
  id       INTEGER PRIMARY KEY,
  path     TEXT NOT NULL UNIQUE,
  excluded INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS folders (
  id          INTEGER PRIMARY KEY,
  path        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  date_min    INTEGER NOT NULL DEFAULT 0,
  date_max    INTEGER NOT NULL DEFAULT 0,
  updated     INTEGER NOT NULL DEFAULT 0,
  photo_count INTEGER NOT NULL DEFAULT 0,
  bytes       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS photos (
  id          INTEGER PRIMARY KEY,
  folder_id   INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  path        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  mtime       INTEGER NOT NULL,
  taken       INTEGER,
  width       INTEGER NOT NULL DEFAULT 0,
  height      INTEGER NOT NULL DEFAULT 0,
  orientation INTEGER NOT NULL DEFAULT 1,
  make        TEXT NOT NULL DEFAULT '',
  model       TEXT NOT NULL DEFAULT '',
  has_gps     INTEGER NOT NULL DEFAULT 0,
  exif        TEXT NOT NULL DEFAULT '[]',
  caption     TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '',
  starred     INTEGER NOT NULL DEFAULT 0,
  edits       TEXT NOT NULL DEFAULT '',
  meta_done   INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS photos_by_folder ON photos(folder_id, taken, name);

CREATE VIRTUAL TABLE IF NOT EXISTS photos_fts USING fts5(
  name, folder, caption, tags, camera,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '1 2 3'
);
"#;

/// Open the library, repairing it if it is damaged: a broken database is moved aside, a fresh
/// one is created, and whatever is still readable (watched folders, folders, photo rows with
/// stars/captions/tags/edits) is copied across. The next scan fills in anything missing, so the
/// app always starts.
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
  match open_checked(path) {
    Ok(conn) => Ok(conn),
    Err(e) => {
      log::error!("library database is damaged ({e}); rebuilding it");
      let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
      let damaged = path.with_file_name(format!("library.damaged-{stamp}.db"));
      for suffix in ["", "-wal", "-shm"] {
        let from = PathBuf::from(format!("{}{suffix}", path.display()));
        let to = PathBuf::from(format!("{}{suffix}", damaged.display()));
        if from.exists() {
          let _ = std::fs::rename(&from, &to);
        }
      }
      let conn = open_checked(path)?;
      salvage(&conn, &damaged);
      Ok(conn)
    }
  }
}

fn open_checked(path: &Path) -> rusqlite::Result<Connection> {
  let conn = Connection::open(path)?;
  conn.query_row("PRAGMA journal_mode=WAL", [], |_| Ok(()))?;
  conn.execute_batch(
    "PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY; PRAGMA foreign_keys=ON; PRAGMA cache_size=-65536;",
  )?;
  let status: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
  if status != "ok" {
    return Err(rusqlite::Error::SqliteFailure(
      rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CORRUPT),
      Some(status.lines().next().unwrap_or("corrupt").to_string()),
    ));
  }
  conn.execute_batch(SCHEMA)?;
  migrate(&conn)?;
  Ok(conn)
}

/// Best-effort copy of readable data from a damaged library. Each step may fail independently.
fn salvage(conn: &Connection, damaged: &Path) {
  if conn.execute("ATTACH DATABASE ?1 AS old", [damaged.to_string_lossy()]).is_err() {
    return;
  }
  let steps = [
    ("roots", "INSERT OR IGNORE INTO roots(path, excluded) SELECT path, excluded FROM old.roots"),
    ("folders", "INSERT OR IGNORE INTO folders(id, path, name, description) SELECT id, path, name, description FROM old.folders"),
    (
      "photos",
      "INSERT OR IGNORE INTO photos(id, folder_id, path, name, size, mtime, taken, width, height, orientation, make, model,
         has_gps, exif, caption, tags, starred, edits)
       SELECT id, folder_id, path, name, size, mtime, taken, width, height, orientation, make, model,
         has_gps, exif, caption, tags, starred, edits FROM old.photos",
    ),
  ];
  let album_steps = [
    ("albums", "INSERT OR IGNORE INTO albums(id, name, description, created) SELECT id, name, description, created FROM old.albums"),
    (
      "album photos",
      "INSERT OR IGNORE INTO album_photos(album_id, photo_id, pos)
       SELECT a.album_id, a.photo_id, a.pos FROM old.album_photos a WHERE a.photo_id IN (SELECT id FROM photos)",
    ),
  ];
  for (name, sql) in steps.into_iter().chain(album_steps) {
    match conn.execute(sql, []) {
      Ok(n) => log::info!("salvaged {n} {name}"),
      Err(e) => log::warn!("could not salvage {name}: {e}"),
    }
  }
  let _ = conn.execute_batch(
    "DELETE FROM photos_fts;
     INSERT INTO photos_fts(rowid, name, folder, caption, tags, camera)
       SELECT p.id, p.name, f.name || ' ' || f.description, p.caption, p.tags, p.make || ' ' || p.model
       FROM photos p JOIN folders f ON f.id = p.folder_id;",
  );
  let _ = conn.execute("DETACH DATABASE old", []);
}

/// Additive migrations for libraries created by older versions.
fn migrate(conn: &Connection) -> rusqlite::Result<()> {
  let has = |col: &str| -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare("SELECT 1 FROM pragma_table_info('photos') WHERE name = ?1")?;
    stmt.exists([col])
  };
  // v0.3: two-phase scanning. Rows from older versions were fully read at scan time.
  if !has("meta_done")? {
    conn.execute_batch("ALTER TABLE photos ADD COLUMN meta_done INTEGER NOT NULL DEFAULT 1")?;
  }
  conn.execute_batch("CREATE INDEX IF NOT EXISTS photos_pending ON photos(meta_done) WHERE meta_done = 0")?;
  // v0.7.7: Folder › Sort Folder By / Sort Album By ('' = date taken, 'modified', 'name', 'size').
  let has_col = |table: &str, col: &str| -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare(&format!("SELECT 1 FROM pragma_table_info('{table}') WHERE name = ?1"))?;
    stmt.exists([col])
  };
  if !has_col("folders", "sort")? {
    conn.execute_batch("ALTER TABLE folders ADD COLUMN sort TEXT NOT NULL DEFAULT ''")?;
  }
  // v0.7.1: online-only cloud files (OneDrive / Synology / Dropbox placeholders, Google Drive
  // streaming). They're listed but never read in the background, so scanning doesn't download them.
  if !has("cloud")? {
    conn.execute_batch("ALTER TABLE photos ADD COLUMN cloud INTEGER NOT NULL DEFAULT 0")?;
  }
  // v0.5: albums. Photos are referenced by id; deleting a photo drops it from its albums.
  conn.execute_batch(
    "CREATE TABLE IF NOT EXISTS albums (
       id          INTEGER PRIMARY KEY,
       name        TEXT NOT NULL,
       description TEXT NOT NULL DEFAULT '',
       created     INTEGER NOT NULL DEFAULT (strftime('%s','now'))
     );
     CREATE TABLE IF NOT EXISTS album_photos (
       album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
       photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
       pos      INTEGER NOT NULL,
       PRIMARY KEY (album_id, photo_id)
     );",
  )?;
  // A per-library id, used in image URLs so the webview's HTTP cache never mixes up libraries.
  conn.execute_batch("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")?;
  let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
  conn.execute("INSERT OR IGNORE INTO meta(key, value) VALUES ('library_id', ?1)", [format!("{nanos:x}")])?;
  if !has_col("albums", "sort")? {
    conn.execute_batch("ALTER TABLE albums ADD COLUMN sort TEXT NOT NULL DEFAULT ''")?;
  }
  // v0.7.9: People. Faces are found in the background (faces_done: 0 to do, 1 done, 2 skipped).
  // Face state: 0 unnamed, 1 named, 2 suggested name awaiting confirmation, 3 ignored.
  // Face source: 0 found by Picaluma, 1 added by hand, 2 imported from Picasa's name tags.
  // v0.7.11: Places (EXIF GPS positions, in degrees).
  if !has("lat")? {
    conn.execute_batch("ALTER TABLE photos ADD COLUMN lat REAL; ALTER TABLE photos ADD COLUMN lon REAL;")?;
  }
  // v0.7.10: Picture › Hide.
  if !has("hidden")? {
    conn.execute_batch("ALTER TABLE photos ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0")?;
  }
  if !has("faces_done")? {
    conn.execute_batch("ALTER TABLE photos ADD COLUMN faces_done INTEGER NOT NULL DEFAULT 0")?;
  }
  conn.execute_batch(
    "CREATE INDEX IF NOT EXISTS photos_faces_pending ON photos(faces_done) WHERE faces_done = 0;
     CREATE INDEX IF NOT EXISTS photos_faces_todo ON photos(COALESCE(taken, mtime) DESC) WHERE faces_done = 0;
     CREATE TABLE IF NOT EXISTS people (
       id      INTEGER PRIMARY KEY,
       name    TEXT NOT NULL UNIQUE COLLATE NOCASE,
       cover   INTEGER,
       created INTEGER NOT NULL DEFAULT (strftime('%s','now'))
     );
     CREATE TABLE IF NOT EXISTS faces (
       id        INTEGER PRIMARY KEY,
       photo_id  INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
       x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
       score     REAL NOT NULL DEFAULT 0,
       emb       BLOB,
       person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
       state     INTEGER NOT NULL DEFAULT 0,
       cluster   INTEGER,
       source    INTEGER NOT NULL DEFAULT 0
     );
     CREATE INDEX IF NOT EXISTS faces_photo ON faces(photo_id);
     CREATE INDEX IF NOT EXISTS faces_person ON faces(person_id, state);
     CREATE INDEX IF NOT EXISTS faces_cluster ON faces(cluster) WHERE state = 0;
     CREATE TABLE IF NOT EXISTS face_rejects (
       face_id   INTEGER NOT NULL REFERENCES faces(id) ON DELETE CASCADE,
       person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
       PRIMARY KEY (face_id, person_id)
     );",
  )?;
  Ok(())
}

pub fn library_id(conn: &Connection) -> String {
  conn.query_row("SELECT value FROM meta WHERE key = 'library_id'", [], |r| r.get(0)).unwrap_or_default()
}

/// Keeps the library file small. Every re-index leaves the old full-text rows in the index's
/// segments until they are merged (11k photos had grown a 530 MB index), so merge them, and
/// rewrite the file when more than a quarter of it is free pages. Runs after each scan.
pub fn compact(conn: &Connection) -> rusqlite::Result<()> {
  let started = std::time::Instant::now();
  conn.execute("INSERT INTO photos_fts(photos_fts) VALUES('optimize')", [])?;
  let free: i64 = conn.query_row("PRAGMA freelist_count", [], |r| r.get(0))?;
  let pages: i64 = conn.query_row("PRAGMA page_count", [], |r| r.get(0))?;
  let vacuum = pages > 2_560 && free * 4 > pages;
  if vacuum {
    conn.execute_batch("VACUUM")?;
  }
  conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))?;
  log::info!("library compacted in {:?} (vacuum: {vacuum}, {free} of {pages} pages were free)", started.elapsed());
  Ok(())
}

/// Rebuild one photo's full-text row. Called after insert/update and caption edits.
pub fn reindex_photo(conn: &Connection, photo_id: i64) -> rusqlite::Result<()> {
  conn.execute("DELETE FROM photos_fts WHERE rowid = ?1", [photo_id])?;
  conn.execute(
    "INSERT INTO photos_fts(rowid, name, folder, caption, tags, camera)
     SELECT p.id, p.name, f.name || ' ' || f.description, p.caption, p.tags, p.make || ' ' || p.model
     FROM photos p JOIN folders f ON f.id = p.folder_id WHERE p.id = ?1",
    [photo_id],
  )?;
  Ok(())
}

/// Recompute a folder's cached aggregates after its photos change.
pub fn refresh_folder(conn: &Connection, folder_id: i64) -> rusqlite::Result<()> {
  conn.execute(
    "UPDATE folders SET
       photo_count = (SELECT COUNT(*) FROM photos WHERE folder_id = ?1),
       bytes       = (SELECT COALESCE(SUM(size), 0) FROM photos WHERE folder_id = ?1),
       date_min    = (SELECT COALESCE(MIN(COALESCE(taken, mtime)), 0) FROM photos WHERE folder_id = ?1),
       date_max    = (SELECT COALESCE(MAX(COALESCE(taken, mtime)), 0) FROM photos WHERE folder_id = ?1),
       updated     = (SELECT COALESCE(MAX(mtime), 0) FROM photos WHERE folder_id = ?1)
     WHERE id = ?1",
    [folder_id],
  )?;
  Ok(())
}

#[cfg(test)]
mod compact_tests {
  use super::*;
  use rusqlite::params;

  #[test]
  fn compact_shrinks_a_churned_index() {
    let dir = std::env::temp_dir().join(format!("picaluma-compact-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let conn = open(&dir.join("library.db")).unwrap();
    conn.execute("INSERT INTO folders(path, name) VALUES ('/p', 'Trip')", []).unwrap();
    for i in 0..300 {
      conn
        .execute("INSERT INTO photos(folder_id, path, name, size, mtime) VALUES (1, ?1, ?2, 1, 1)", params![format!("/p/IMG_{i}.jpg"), format!("IMG_{i}.jpg")])
        .unwrap();
    }
    // Re-index every photo many times, one transaction each, as scanning does.
    for _ in 0..20 {
      for id in 1..=300 {
        reindex_photo(&conn, id).unwrap();
      }
    }
    let size = |c: &Connection| -> i64 { c.query_row("SELECT SUM(LENGTH(block)) FROM photos_fts_data", [], |r| r.get(0)).unwrap() };
    let before = size(&conn);
    compact(&conn).unwrap();
    let after = size(&conn);
    assert!(after < before, "index {before} -> {after} bytes");
    let hits: i64 = conn.query_row("SELECT COUNT(*) FROM photos_fts WHERE photos_fts MATCH 'img*'", [], |r| r.get(0)).unwrap();
    assert_eq!(hits, 300, "search still finds every photo");
    let _ = std::fs::remove_dir_all(&dir);
  }
}
