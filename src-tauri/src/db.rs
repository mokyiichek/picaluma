use std::path::Path;

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

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
  let conn = Connection::open(path)?;
  conn.query_row("PRAGMA journal_mode=WAL", [], |_| Ok(()))?;
  conn.execute_batch(
    "PRAGMA synchronous=NORMAL; PRAGMA temp_store=MEMORY; PRAGMA foreign_keys=ON; PRAGMA cache_size=-65536;",
  )?;
  conn.execute_batch(SCHEMA)?;
  migrate(&conn)?;
  Ok(conn)
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
