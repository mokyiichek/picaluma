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
  for (name, sql) in steps {
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
  // A per-library id, used in image URLs so the webview's HTTP cache never mixes up libraries.
  conn.execute_batch("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")?;
  let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
  conn.execute("INSERT OR IGNORE INTO meta(key, value) VALUES ('library_id', ?1)", [format!("{nanos:x}")])?;
  Ok(())
}

pub fn library_id(conn: &Connection) -> String {
  conn.query_row("SELECT value FROM meta WHERE key = 'library_id'", [], |r| r.get(0)).unwrap_or_default()
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
