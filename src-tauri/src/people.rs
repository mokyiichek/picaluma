//! People, the Picasa way: faces are found in the background, similar unnamed faces are grouped,
//! naming a group makes a person album, and faces that look like a named person are offered as
//! suggestions to confirm or reject. Picasa's own name tags (`.picasa.ini`) are imported.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::http::{Request, Response};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::faces::{self, Engine};
use crate::AppState;

type CmdResult<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
  e.to_string()
}

// Face states (3 = ignored) and sources (0 = found by Picaluma); see db.rs.
const UNNAMED: i64 = 0;
const NAMED: i64 = 1;
const SUGGESTED: i64 = 2;
const SOURCE_MANUAL: i64 = 1;
const SOURCE_PICASA: i64 = 2;

/// Likeness at which a face is suggested as a named person: the average similarity to their
/// three closest named faces (pairs measured on Picasa-tagged photos: at 0.40, 86% of
/// same-person pairs and 0.6% of different-person pairs; averaging three cuts the strays).
const SUGGEST: f32 = 0.40;
/// Similarity at which unnamed faces are grouped (stricter: groups are named in one go).
const GROUP: f32 = 0.45;
/// Signatures kept per person for matching.
const SAMPLES: usize = 150;

static RUNNING: AtomicBool = AtomicBool::new(false);
/// Bumped whenever names change, so the background finder reloads who is who.
static VERSION: AtomicU64 = AtomicU64::new(0);
/// Folder the user is looking at: its faces are found first.
static PRIORITY: AtomicI64 = AtomicI64::new(-1);
static PROGRESS: Mutex<Progress> = Mutex::new(Progress { running: false, done: 0, total: 0 });

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
  running: bool,
  done: u64,
  total: u64,
}

fn bump() {
  VERSION.fetch_add(1, Ordering::SeqCst);
}

pub fn prioritize(folder_id: i64) {
  PRIORITY.store(folder_id, Ordering::Relaxed);
}

/// Start finding faces in pictures that haven't been looked at yet (no-op if already running or
/// turned off in Options).
pub fn kick(app: &AppHandle) {
  let state = app.state::<AppState>();
  if !crate::settings::load(&state.data_dir).face_recognition || RUNNING.swap(true, Ordering::SeqCst) {
    return;
  }
  let app = app.clone();
  let _ = std::thread::Builder::new().name("faces".into()).spawn(move || {
    if let Err(e) = run(&app) {
      log::warn!("face finder stopped: {e}");
    }
    PROGRESS.lock().unwrap().running = false;
    let _ = app.emit("faces-progress", *PROGRESS.lock().unwrap());
    let _ = app.emit("library-changed", ());
    RUNNING.store(false, Ordering::SeqCst);
  });
}

fn face_dir(app: &AppHandle) -> PathBuf {
  app.state::<AppState>().data_dir.join("faces")
}

fn models_dir(app: &AppHandle) -> PathBuf {
  app.state::<AppState>().data_dir.join("models")
}

static DOWNLOAD: Mutex<Models> = Mutex::new(Models { ready: false, downloading: false, received: 0, total: 0, error: None });

/// The face models: whether they're here, or how the download is going.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Models {
  ready: bool,
  downloading: bool,
  received: u64,
  total: u64,
  error: Option<String>,
}

#[tauri::command(async)]
pub fn face_models_status(app: AppHandle) -> Models {
  let mut m = DOWNLOAD.lock().unwrap().clone();
  m.ready = faces::models_ready(&models_dir(&app));
  m.total = faces::models_size();
  m
}

/// Downloads the face models (only ever on the user's say-so), then starts finding faces.
#[tauri::command(async)]
pub fn download_face_models(app: AppHandle) {
  {
    let mut d = DOWNLOAD.lock().unwrap();
    if d.downloading {
      return;
    }
    *d = Models { ready: false, downloading: true, received: 0, total: faces::models_size(), error: None };
  }
  std::thread::spawn(move || {
    let last = std::cell::Cell::new(Instant::now());
    let result = faces::download_models(&models_dir(&app), |received, _| {
      DOWNLOAD.lock().unwrap().received = received;
      if last.get().elapsed() > Duration::from_millis(250) {
        last.set(Instant::now());
        let _ = app.emit("face-models", face_models_status(app.clone()));
      }
    });
    {
      let mut d = DOWNLOAD.lock().unwrap();
      d.downloading = false;
      d.error = result.as_ref().err().cloned();
    }
    let _ = app.emit("face-models", face_models_status(app.clone()));
    if result.is_ok() {
      log::info!("face models downloaded");
      kick(&app);
    }
  });
}

fn run(app: &AppHandle) -> Result<(), String> {
  let state = app.state::<AppState>();
  let db = state.db.clone();
  let dir = face_dir(app);
  std::fs::create_dir_all(&dir).map_err(err)?;
  import_picasa_once(&db);
  // Faces are only looked for once the user has agreed to download the models.
  if !faces::models_ready(&models_dir(app)) {
    let _ = app.emit("library-changed", ());
    return Ok(());
  }
  let total: u64 = db.lock().unwrap().query_row("SELECT COUNT(*) FROM photos WHERE faces_done = 0", [], |r| r.get(0)).map_err(err)?;
  if total == 0 {
    return Ok(());
  }
  *PROGRESS.lock().unwrap() = Progress { running: true, done: 0, total };
  let started = Instant::now();
  let engine = Engine::load(&models_dir(app))?;
  log::info!("face finder: {total} pictures to look at (models loaded in {:?})", started.elapsed());
  let mut index = Index::load(&db.lock().unwrap());
  let mut version = VERSION.load(Ordering::SeqCst);
  let mut last_emit = Instant::now();
  let mut last_reload = Instant::now();
  let mut done = 0u64;
  loop {
    if !crate::settings::load(&state.data_dir).face_recognition {
      break;
    }
    // Stay out of the way of scanning and thumbnails (and keep older PCs cool).
    while state.scanning.load(Ordering::SeqCst) || state.warming.load(Ordering::SeqCst) || state.thumbs.pending() > 0 {
      std::thread::sleep(Duration::from_millis(1500));
    }
    if VERSION.load(Ordering::SeqCst) != version {
      version = VERSION.load(Ordering::SeqCst);
      index = Index::load(&db.lock().unwrap());
    }
    let batch = pending(&db.lock().unwrap(), PRIORITY.load(Ordering::Relaxed)).map_err(err)?;
    if batch.is_empty() {
      break;
    }
    for (id, path) in batch {
      let found = match faces::load_upright(&path, faces::ANALYSE_EDGE) {
        Ok(img) => match engine.analyze(&img) {
          Ok(found) => Some((img, found)),
          Err(e) => {
            log::warn!("faces {path}: {e}");
            None
          }
        },
        Err(_) => None,
      };
      match found {
        Some((img, found)) => {
          let crops = save_faces(&db, id, &found, &mut index).map_err(err)?;
          for (face_id, rect) in crops {
            write_crop(&dir, face_id, &img, rect);
          }
        }
        None => {
          let _ = db.lock().unwrap().execute("UPDATE photos SET faces_done = 2 WHERE id = ?1", [id]);
        }
      }
      done += 1;
      std::thread::sleep(Duration::from_millis(10));
    }
    PROGRESS.lock().unwrap().done = done;
    if last_emit.elapsed() > Duration::from_secs(2) {
      last_emit = Instant::now();
      let _ = app.emit("faces-progress", *PROGRESS.lock().unwrap());
    }
    // The People list grows as faces are found.
    if last_reload.elapsed() > Duration::from_secs(20) {
      last_reload = Instant::now();
      let _ = app.emit("library-changed", ());
    }
  }
  log::info!("face finder: looked at {done} pictures in {:?}", started.elapsed());
  // Faces found before a person's tagged faces were looked at couldn't be matched to them yet.
  let people: Vec<i64> = {
    let conn = db.lock().unwrap();
    let mut stmt = conn.prepare("SELECT DISTINCT person_id FROM faces WHERE state = 1 AND emb IS NOT NULL").map_err(err)?;
    let rows = stmt.query_map([], |r| r.get(0)).map_err(err)?;
    rows.filter_map(Result::ok).collect()
  };
  let mut offered = 0;
  for p in people {
    offered += suggest_for(&db, p);
  }
  log::info!("face finder: {offered} suggestions to confirm");
  bump();
  Ok(())
}

/// The next pictures to look at: the folder on screen first, then the newest.
fn pending(conn: &Connection, priority: i64) -> rusqlite::Result<Vec<(i64, String)>> {
  // Two indexed queries rather than one sort of every waiting picture (700k in a big library).
  let mut rows: Vec<(i64, String, i64)> = {
    let mut stmt = conn.prepare_cached("SELECT id, path, cloud FROM photos WHERE folder_id = ?1 AND faces_done = 0 LIMIT 24")?;
    let r = stmt.query_map([priority], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    r.filter_map(Result::ok).collect()
  };
  if rows.is_empty() {
    let mut stmt = conn.prepare_cached("SELECT id, path, cloud FROM photos WHERE faces_done = 0 ORDER BY COALESCE(taken, mtime) DESC LIMIT 24")?;
    let r = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    rows = r.filter_map(Result::ok).collect();
  }
  let mut out = Vec::new();
  for (id, path, cloud) in rows {
    // Movies and online-only cloud files (reading them would download them) are skipped.
    if cloud != 0 || crate::formats::is_video(&path) {
      conn.execute("UPDATE photos SET faces_done = 2 WHERE id = ?1", [id])?;
    } else {
      out.push((id, path));
    }
  }
  Ok(out)
}

/// Who is who, for matching new faces: a few signatures per named person, and the running
/// average signature of each group of unnamed faces.
struct Index {
  people: Vec<(i64, Vec<Vec<f32>>)>,
  groups: HashMap<i64, (Vec<f32>, u32)>,
}

impl Index {
  fn load(conn: &Connection) -> Index {
    let mut people: Vec<(i64, Vec<Vec<f32>>)> = Vec::new();
    if let Ok(mut stmt) = conn.prepare("SELECT person_id, emb FROM faces WHERE state = 1 AND emb IS NOT NULL ORDER BY person_id, score DESC") {
      let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Vec<u8>>(1)?)));
      for (pid, blob) in rows.into_iter().flatten().flatten() {
        match people.last_mut() {
          Some((p, v)) if *p == pid => {
            if v.len() < SAMPLES {
              v.push(faces::from_blob(&blob));
            }
          }
          _ => people.push((pid, vec![faces::from_blob(&blob)])),
        }
      }
    }
    let mut groups: HashMap<i64, (Vec<f32>, u32)> = HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT cluster, emb FROM faces WHERE state = 0 AND emb IS NOT NULL AND cluster IS NOT NULL") {
      let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Vec<u8>>(1)?)));
      for (c, blob) in rows.into_iter().flatten().flatten() {
        let e = faces::from_blob(&blob);
        let g = groups.entry(c).or_insert_with(|| (vec![0.0; e.len()], 0));
        for (s, x) in g.0.iter_mut().zip(&e) {
          *s += x;
        }
        g.1 += 1;
      }
    }
    Index { people, groups }
  }

  fn best_person(&self, emb: &[f32]) -> Option<(i64, f32)> {
    self.people.iter().map(|(p, samples)| (*p, likeness(emb, samples))).max_by(|a, b| a.1.total_cmp(&b.1))
  }

  fn best_group(&self, emb: &[f32]) -> Option<(i64, f32)> {
    self
      .groups
      .iter()
      .map(|(c, (sum, _))| {
        let n = sum.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-6);
        (*c, faces::similarity(emb, sum) / n)
      })
      .max_by(|a, b| a.1.total_cmp(&b.1))
  }

  fn join(&mut self, group: i64, emb: &[f32]) {
    let g = self.groups.entry(group).or_insert_with(|| (vec![0.0; emb.len()], 0));
    for (s, x) in g.0.iter_mut().zip(emb) {
      *s += x;
    }
    g.1 += 1;
  }
}

/// How much a face looks like a person: mean similarity to their three closest faces.
fn likeness(emb: &[f32], samples: &[Vec<f32>]) -> f32 {
  let mut top = [f32::MIN; 3];
  for s in samples {
    let v = faces::similarity(emb, s);
    if v > top[2] {
      top[2] = v;
      top.sort_by(|a, b| b.total_cmp(a));
    }
  }
  let k = samples.len().min(3);
  if k == 0 {
    f32::MIN
  } else {
    top[..k].iter().sum::<f32>() / k as f32
  }
}

/// Stores the faces found in one picture. Names already given (by hand, or imported from
/// Picasa) are kept and attached to the matching face. Returns the new faces to crop.
fn save_faces(db: &Arc<Mutex<Connection>>, photo: i64, found: &[faces::Face], index: &mut Index) -> rusqlite::Result<Vec<(i64, [f32; 4])>> {
  let mut conn = db.lock().unwrap();
  let tx = conn.transaction()?;
  tx.execute("DELETE FROM faces WHERE photo_id = ?1 AND source = 0 AND state IN (0, 2)", [photo])?;
  let orientation: i64 = tx.query_row("SELECT orientation FROM photos WHERE id = ?1", [photo], |r| r.get(0)).unwrap_or(1);
  // id, rectangle, source, person, has a signature
  type Kept = (i64, [f32; 4], i64, Option<i64>, bool);
  let kept: Vec<Kept> = {
    let mut stmt = tx.prepare("SELECT id, x, y, w, h, source, person_id, emb IS NOT NULL FROM faces WHERE photo_id = ?1")?;
    let rows = stmt.query_map([photo], |r| Ok((r.get(0)?, [r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?], r.get(5)?, r.get(6)?, r.get(7)?)))?;
    rows.filter_map(Result::ok).collect()
  };
  let mut crops = Vec::new();
  for f in found {
    let rect = [f.x, f.y, f.w, f.h];
    let blob = faces::to_blob(&f.emb);
    // A face already tagged here (by hand or in Picasa): give it this face's signature.
    let same = kept.iter().find(|k| faces::overlap(k.1, rect) > 0.3 || (k.2 == SOURCE_PICASA && faces::overlap(rotate_rect(k.1, orientation), rect) > 0.3));
    if let Some(k) = same {
      if !k.4 {
        tx.execute(
          "UPDATE faces SET x = ?2, y = ?3, w = ?4, h = ?5, score = ?6, emb = ?7, source = 0 WHERE id = ?1",
          params![k.0, rect[0], rect[1], rect[2], rect[3], f.score, blob],
        )?;
        crops.push((k.0, rect));
        if let Some(p) = k.3 {
          if let Some(entry) = index.people.iter_mut().find(|e| e.0 == p) {
            entry.1.push(f.emb.clone());
          } else {
            index.people.push((p, vec![f.emb.clone()]));
          }
        }
      }
      continue;
    }
    let (person, state, group) = match index.best_person(&f.emb) {
      Some((p, s)) if s >= SUGGEST => (Some(p), SUGGESTED, None),
      _ => match index.best_group(&f.emb) {
        Some((g, s)) if s >= GROUP => (None, UNNAMED, Some(g)),
        _ => (None, UNNAMED, None),
      },
    };
    tx.execute(
      "INSERT INTO faces(photo_id, x, y, w, h, score, emb, person_id, state, cluster, source) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0)",
      params![photo, rect[0], rect[1], rect[2], rect[3], f.score, blob, person, state, group],
    )?;
    let id = tx.last_insert_rowid();
    if state == UNNAMED {
      let g = group.unwrap_or(id);
      if group.is_none() {
        tx.execute("UPDATE faces SET cluster = ?1 WHERE id = ?1", [id])?;
      }
      index.join(g, &f.emb);
    }
    crops.push((id, rect));
  }
  tx.execute("UPDATE photos SET faces_done = 1 WHERE id = ?1", [photo])?;
  tx.commit()?;
  Ok(crops)
}

/// A rectangle given on the stored (unrotated) picture, on the upright picture.
fn rotate_rect(r: [f32; 4], orientation: i64) -> [f32; 4] {
  let [x, y, w, h] = r;
  match orientation {
    3 => [1.0 - x - w, 1.0 - y - h, w, h],
    6 => [1.0 - y - h, x, h, w],
    8 => [y, 1.0 - x - w, h, w],
    _ => r,
  }
}

/// A square close-up around the face, as in Picasa's people thumbnails.
fn crop_face(img: &image::RgbImage, rect: [f32; 4]) -> Option<Vec<u8>> {
  let (w, h) = (img.width() as f32, img.height() as f32);
  let side = (rect[2] * w).max(rect[3] * h) * 1.7;
  let cx = (rect[0] + rect[2] / 2.0) * w;
  let cy = (rect[1] + rect[3] / 2.0) * h;
  let side = side.min(w).min(h).max(8.0);
  let x0 = (cx - side / 2.0).clamp(0.0, w - side);
  let y0 = (cy - side / 2.0).clamp(0.0, h - side);
  let sub = image::imageops::crop_imm(img, x0 as u32, y0 as u32, side as u32, side as u32).to_image();
  let small = image::imageops::resize(&sub, 160, 160, image::imageops::FilterType::Triangle);
  let mut out = Vec::new();
  image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 85).encode_image(&small).ok()?;
  Some(out)
}

fn write_crop(dir: &Path, id: i64, img: &image::RgbImage, rect: [f32; 4]) {
  if let Some(bytes) = crop_face(img, rect) {
    let _ = std::fs::write(dir.join(format!("{id}.jpg")), bytes);
  }
}

/// `face://localhost/<id>`: the face's close-up, made from the picture on first use.
pub fn handle_face(app: &AppHandle, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
  let id: Option<i64> = req.uri().path().trim_start_matches('/').split(['/', '?']).next().and_then(|s| s.parse().ok());
  let not_found = || Response::builder().status(404).header("Access-Control-Allow-Origin", "*").body(Vec::new()).unwrap();
  let Some(id) = id else { return not_found() };
  let dir = face_dir(app);
  let file = dir.join(format!("{id}.jpg"));
  let bytes = std::fs::read(&file).ok().or_else(|| {
    let (path, rect): (String, [f32; 4]) = {
      let state = app.state::<AppState>();
      let conn = state.db.lock().ok()?;
      conn
        .query_row("SELECT p.path, f.x, f.y, f.w, f.h FROM faces f JOIN photos p ON p.id = f.photo_id WHERE f.id = ?1", [id], |r| {
          Ok((r.get(0)?, [r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?]))
        })
        .ok()?
    };
    let img = faces::load_upright(&path, faces::ANALYSE_EDGE).ok()?;
    let bytes = crop_face(&img, rect)?;
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(&file, &bytes);
    Some(bytes)
  });
  match bytes {
    Some(b) => Response::builder()
      .header("Content-Type", "image/jpeg")
      .header("Cache-Control", "max-age=31536000")
      .header("Access-Control-Allow-Origin", "*")
      .body(b)
      .unwrap(),
    None => not_found(),
  }
}

// ---------- Picasa name tags ----------

/// Imports Picasa's name tags once per library (Tools › People Manager can run it again).
fn import_picasa_once(db: &Arc<Mutex<Connection>>) {
  let done = db.lock().unwrap().query_row("SELECT 1 FROM meta WHERE key = 'picasa_faces'", [], |_| Ok(())).optional().ok().flatten().is_some();
  if !done {
    match import_picasa(db) {
      Ok((people, tags)) => log::info!("imported {tags} Picasa name tags for {people} people"),
      Err(e) => log::warn!("Picasa name tags: {e}"),
    }
    let _ = db.lock().unwrap().execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('picasa_faces', '1')", []);
  }
}

fn import_picasa(db: &Arc<Mutex<Connection>>) -> rusqlite::Result<(usize, usize)> {
  let folders: Vec<(i64, String)> = {
    let conn = db.lock().unwrap();
    let mut stmt = conn.prepare("SELECT id, path FROM folders")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.filter_map(Result::ok).collect()
  };
  // Read every folder's tags first: a name can be defined in another folder's file.
  let mut contacts: HashMap<String, String> = HashMap::new();
  let mut tags: Vec<(i64, String, Vec<crate::picasa::Tag>)> = Vec::new();
  for (fid, path) in folders {
    let ini = crate::picasa::read_ini(Path::new(&path));
    contacts.extend(ini.contacts);
    for (file, rects) in ini.faces {
      tags.push((fid, file, rects));
    }
  }
  let mut conn = db.lock().unwrap();
  let tx = conn.transaction()?;
  let mut people: HashMap<String, i64> = HashMap::new();
  let mut added = 0;
  for (fid, file, rects) in tags {
    let photo: Option<i64> = tx
      .query_row("SELECT id FROM photos WHERE folder_id = ?1 AND name = ?2 COLLATE NOCASE", params![fid, file], |r| r.get(0))
      .optional()?;
    let Some(photo) = photo else { continue };
    let existing: Vec<([f32; 4], Option<i64>)> = {
      let mut stmt = tx.prepare("SELECT x, y, w, h, person_id FROM faces WHERE photo_id = ?1")?;
      let rows = stmt.query_map([photo], |r| Ok(([r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?], r.get(4)?)))?;
      rows.filter_map(Result::ok).collect()
    };
    for (rect, contact) in rects {
      let Some(name) = contacts.get(&contact) else { continue };
      let pid = match people.get(name) {
        Some(p) => *p,
        None => {
          tx.execute("INSERT OR IGNORE INTO people(name) VALUES (?1)", [name])?;
          let p: i64 = tx.query_row("SELECT id FROM people WHERE name = ?1", [name], |r| r.get(0))?;
          people.insert(name.clone(), p);
          p
        }
      };
      if existing.iter().any(|(r, p)| *p == Some(pid) && faces::overlap(*r, rect) > 0.3) {
        continue;
      }
      // If the picture's faces were already found, name the matching one.
      let n = tx.execute(
        "UPDATE faces SET person_id = ?1, state = 1 WHERE id = (
           SELECT id FROM faces WHERE photo_id = ?2 AND state IN (0, 2)
           AND MAX(0, MIN(x + w, ?3 + ?5) - MAX(x, ?3)) * MAX(0, MIN(y + h, ?4 + ?6) - MAX(y, ?4)) > 0.3 * w * h LIMIT 1)",
        params![pid, photo, rect[0], rect[1], rect[2], rect[3]],
      )?;
      if n == 0 {
        tx.execute(
          "INSERT INTO faces(photo_id, x, y, w, h, person_id, state, source) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 2)",
          params![photo, rect[0], rect[1], rect[2], rect[3], pid],
        )?;
      }
      added += 1;
    }
  }
  tx.commit()?;
  bump();
  Ok((people.len(), added))
}

// ---------- Commands ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceDto {
  id: i64,
  photo_id: i64,
  x: f32,
  y: f32,
  w: f32,
  h: f32,
  person_id: Option<i64>,
  name: Option<String>,
  state: i64,
}

const FACE_COLS: &str = "f.id, f.photo_id, f.x, f.y, f.w, f.h, f.person_id, pe.name, f.state";

fn face_row(r: &rusqlite::Row) -> rusqlite::Result<FaceDto> {
  Ok(FaceDto {
    id: r.get(0)?,
    photo_id: r.get(1)?,
    x: r.get(2)?,
    y: r.get(3)?,
    w: r.get(4)?,
    h: r.get(5)?,
    person_id: r.get(6)?,
    name: r.get(7)?,
    state: r.get(8)?,
  })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonDto {
  id: i64,
  name: String,
  cover: Option<i64>,
  photos: Vec<i64>,
  suggestions: i64,
}

/// People for the library snapshot: person albums (photos in date order), the photos that have
/// faces (Faces filter) and how many faces are still unnamed.
pub fn snapshot(conn: &Connection) -> rusqlite::Result<(Vec<PersonDto>, Vec<i64>, i64)> {
  let mut people: Vec<PersonDto> = {
    let mut stmt = conn.prepare(
      "SELECT pe.id, pe.name, COALESCE(pe.cover, (SELECT id FROM faces WHERE person_id = pe.id AND state = 1 ORDER BY emb IS NULL, score DESC LIMIT 1)),
              (SELECT COUNT(*) FROM faces WHERE person_id = pe.id AND state = 2)
       FROM people pe ORDER BY pe.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| Ok(PersonDto { id: r.get(0)?, name: r.get(1)?, cover: r.get(2)?, photos: Vec::new(), suggestions: r.get(3)? }))?;
    rows.filter_map(Result::ok).collect()
  };
  {
    let pos: HashMap<i64, usize> = people.iter().enumerate().map(|(i, p)| (p.id, i)).collect();
    let mut stmt = conn.prepare(
      "SELECT DISTINCT f.person_id, f.photo_id FROM faces f JOIN photos p ON p.id = f.photo_id
       WHERE f.state = 1 ORDER BY f.person_id, COALESCE(p.taken, p.mtime), p.name",
    )?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?.flatten() {
      if let Some(&i) = pos.get(&row.0) {
        people[i].photos.push(row.1);
      }
    }
  }
  // People with no tagged photos left (all names removed) stay out of the list.
  people.retain(|p| !p.photos.is_empty() || p.suggestions > 0);
  let faced: Vec<i64> = {
    let mut stmt = conn.prepare("SELECT DISTINCT photo_id FROM faces WHERE state IN (0, 1, 2)")?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    rows.filter_map(Result::ok).collect()
  };
  let unnamed: i64 = conn.query_row("SELECT COUNT(*) FROM faces WHERE state = 0", [], |r| r.get(0))?;
  Ok((people, faced, unnamed))
}

/// Photos of people whose name matches every word typed (for search).
pub fn search(conn: &Connection, query: &str) -> Vec<i64> {
  let words: Vec<String> = query.split_whitespace().map(|w| w.to_lowercase()).filter(|w| !w.is_empty()).collect();
  if words.is_empty() {
    return Vec::new();
  }
  let Ok(mut stmt) = conn.prepare_cached("SELECT id, name FROM people") else { return Vec::new() };
  let people: Vec<(i64, String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map(|r| r.filter_map(Result::ok).collect()).unwrap_or_default();
  let matching: Vec<i64> = people
    .into_iter()
    .filter(|(_, name)| {
      let parts: Vec<String> = name.to_lowercase().split_whitespace().map(String::from).collect();
      words.iter().all(|w| parts.iter().any(|p| p.starts_with(w.as_str())))
    })
    .map(|(id, _)| id)
    .collect();
  let mut ids = Vec::new();
  for pid in matching {
    if let Ok(mut s) = conn.prepare_cached("SELECT DISTINCT photo_id FROM faces WHERE person_id = ?1 AND state = 1") {
      ids.extend(s.query_map([pid], |r| r.get::<_, i64>(0)).map(|r| r.filter_map(Result::ok).collect::<Vec<_>>()).unwrap_or_default());
    }
  }
  ids
}

#[tauri::command(async)]
pub fn faces_in_photo(state: State<'_, AppState>, photo_id: i64) -> CmdResult<Vec<FaceDto>> {
  let conn = state.db.lock().map_err(err)?;
  let mut stmt = conn
    .prepare(&format!("SELECT {FACE_COLS} FROM faces f LEFT JOIN people pe ON pe.id = f.person_id WHERE f.photo_id = ?1 AND f.state != 3 ORDER BY f.x"))
    .map_err(err)?;
  let rows = stmt.query_map([photo_id], face_row).map_err(err)?;
  Ok(rows.filter_map(Result::ok).collect())
}

/// A person's faces: named ones, or (`suggested`) the ones waiting for confirmation.
#[tauri::command(async)]
pub fn person_faces(state: State<'_, AppState>, person_id: i64, suggested: bool) -> CmdResult<Vec<FaceDto>> {
  let conn = state.db.lock().map_err(err)?;
  let mut stmt = conn
    .prepare(&format!(
      "SELECT {FACE_COLS} FROM faces f LEFT JOIN people pe ON pe.id = f.person_id JOIN photos p ON p.id = f.photo_id
       WHERE f.person_id = ?1 AND f.state = ?2 ORDER BY COALESCE(p.taken, p.mtime) DESC"
    ))
    .map_err(err)?;
  let rows = stmt.query_map(params![person_id, if suggested { SUGGESTED } else { NAMED }], face_row).map_err(err)?;
  Ok(rows.filter_map(Result::ok).collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceGroup {
  group: i64,
  count: i64,
  faces: Vec<FaceDto>,
}

/// Unnamed faces grouped by likeness, largest groups first (People Manager / Unnamed).
#[tauri::command(async)]
pub fn unnamed_groups(state: State<'_, AppState>, offset: i64, limit: i64) -> CmdResult<Vec<FaceGroup>> {
  let conn = state.db.lock().map_err(err)?;
  let groups: Vec<(i64, i64)> = {
    let mut stmt = conn
      .prepare("SELECT cluster, COUNT(*) c FROM faces WHERE state = 0 AND cluster IS NOT NULL GROUP BY cluster ORDER BY c DESC, MAX(score) DESC LIMIT ?1 OFFSET ?2")
      .map_err(err)?;
    let rows = stmt.query_map([limit, offset], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?;
    rows.filter_map(Result::ok).collect()
  };
  let mut stmt = conn
    .prepare(&format!("SELECT {FACE_COLS} FROM faces f LEFT JOIN people pe ON pe.id = f.person_id WHERE f.cluster = ?1 AND f.state = 0 ORDER BY f.score DESC LIMIT 60"))
    .map_err(err)?;
  let mut out = Vec::new();
  for (group, count) in groups {
    let faces = stmt.query_map([group], face_row).map_err(err)?.filter_map(Result::ok).collect();
    out.push(FaceGroup { group, count, faces });
  }
  Ok(out)
}

fn person_by_name(conn: &Connection, name: &str) -> rusqlite::Result<i64> {
  conn.execute("INSERT OR IGNORE INTO people(name) VALUES (?1)", [name])?;
  conn.query_row("SELECT id FROM people WHERE name = ?1", [name], |r| r.get(0))
}

fn ids_sql(ids: &[i64]) -> String {
  ids.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",")
}

/// Name faces ("Add a name"). Whole groups can be named by passing `groups`.
#[tauri::command(async)]
pub fn name_faces(app: AppHandle, state: State<'_, AppState>, faces: Vec<i64>, groups: Vec<i64>, name: String) -> CmdResult<i64> {
  let name = name.trim().to_string();
  if name.is_empty() {
    return Err("Type a name".into());
  }
  let pid = {
    let conn = state.db.lock().map_err(err)?;
    let pid = person_by_name(&conn, &name).map_err(err)?;
    if !faces.is_empty() {
      conn
        .execute(&format!("UPDATE faces SET person_id = ?1, state = 1, cluster = NULL WHERE id IN ({})", ids_sql(&faces)), [pid])
        .map_err(err)?;
    }
    if !groups.is_empty() {
      conn
        .execute(&format!("UPDATE faces SET person_id = ?1, state = 1, cluster = NULL WHERE state = 0 AND cluster IN ({})", ids_sql(&groups)), [pid])
        .map_err(err)?;
    }
    pid
  };
  bump();
  spawn_suggest(app, pid);
  Ok(pid)
}

/// After a person gains faces: offer every unnamed face that looks like them.
fn spawn_suggest(app: AppHandle, person: i64) {
  std::thread::spawn(move || {
    let db = app.state::<AppState>().db.clone();
    suggest_for(&db, person);
    bump();
    let _ = app.emit("library-changed", ());
  });
}

/// Marks unnamed faces that look like `person` as suggestions; returns how many.
fn suggest_for(db: &Arc<Mutex<Connection>>, person: i64) -> usize {
  {
    let samples: Vec<Vec<f32>> = {
      let conn = db.lock().unwrap();
      let mut stmt = match conn.prepare("SELECT emb FROM faces WHERE person_id = ?1 AND state = 1 AND emb IS NOT NULL ORDER BY score DESC LIMIT ?2") {
        Ok(s) => s,
        Err(_) => return 0,
      };
      let rows = stmt.query_map(params![person, SAMPLES as i64], |r| r.get::<_, Vec<u8>>(0));
      rows.map(|r| r.filter_map(Result::ok).map(|b| faces::from_blob(&b)).collect()).unwrap_or_default()
    };
    if samples.is_empty() {
      return 0;
    }
    let mut last = 0i64;
    let mut hits = Vec::new();
    loop {
      // In chunks, so the library isn't locked for long.
      let chunk: Vec<(i64, Vec<u8>)> = {
        let conn = db.lock().unwrap();
        let mut stmt = conn
          .prepare(
            "SELECT id, emb FROM faces WHERE state = 0 AND emb IS NOT NULL AND id > ?1
             AND id NOT IN (SELECT face_id FROM face_rejects WHERE person_id = ?2) ORDER BY id LIMIT 5000",
          )
          .unwrap();
        let rows = stmt.query_map(params![last, person], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        rows.filter_map(Result::ok).collect()
      };
      let Some((end, _)) = chunk.last() else { break };
      last = *end;
      for (id, blob) in &chunk {
        let e = faces::from_blob(blob);
        if likeness(&e, &samples) >= SUGGEST {
          hits.push(*id);
        }
      }
    }
    if !hits.is_empty() {
      let conn = db.lock().unwrap();
      for part in hits.chunks(500) {
        let _ = conn.execute(&format!("UPDATE faces SET person_id = ?1, state = 2, cluster = NULL WHERE state = 0 AND id IN ({})", ids_sql(part)), [person]);
      }
      log::info!("{} suggestions for person {person}", hits.len());
    }
    hits.len()
  }
}

/// ✔ on suggestions: they become named.
#[tauri::command(async)]
pub fn confirm_faces(app: AppHandle, state: State<'_, AppState>, faces: Vec<i64>) -> CmdResult<()> {
  let person: Option<i64> = {
    let conn = state.db.lock().map_err(err)?;
    conn.execute(&format!("UPDATE faces SET state = 1 WHERE state = 2 AND id IN ({})", ids_sql(&faces)), []).map_err(err)?;
    conn.query_row(&format!("SELECT person_id FROM faces WHERE id IN ({}) LIMIT 1", ids_sql(&faces)), [], |r| r.get(0)).optional().map_err(err)?.flatten()
  };
  bump();
  if let Some(p) = person {
    spawn_suggest(app, p);
  }
  Ok(())
}

/// ✖ on a suggestion, or "Remove name tag": the face goes back to the unnamed faces and won't be
/// suggested as that person again.
#[tauri::command(async)]
pub fn reject_faces(state: State<'_, AppState>, faces: Vec<i64>) -> CmdResult<()> {
  let conn = state.db.lock().map_err(err)?;
  let list = ids_sql(&faces);
  conn
    .execute(&format!("INSERT OR IGNORE INTO face_rejects(face_id, person_id) SELECT id, person_id FROM faces WHERE id IN ({list}) AND person_id IS NOT NULL"), [])
    .map_err(err)?;
  conn.execute(&format!("UPDATE faces SET person_id = NULL, state = 0, cluster = id WHERE id IN ({list})"), []).map_err(err)?;
  bump();
  Ok(())
}

/// "Ignore": the face is hidden from People (Picasa's Ignore / Hide face). `false` brings it back.
#[tauri::command(async)]
pub fn ignore_faces(state: State<'_, AppState>, faces: Vec<i64>, ignore: bool) -> CmdResult<()> {
  let conn = state.db.lock().map_err(err)?;
  let list = ids_sql(&faces);
  if ignore {
    conn.execute(&format!("UPDATE faces SET person_id = NULL, state = 3, cluster = NULL WHERE id IN ({list})"), []).map_err(err)?;
  } else {
    conn.execute(&format!("UPDATE faces SET state = 0, cluster = id WHERE state = 3 AND id IN ({list})"), []).map_err(err)?;
  }
  bump();
  Ok(())
}

/// Rename a person; renaming to an existing name merges the two.
#[tauri::command(async)]
pub fn rename_person(state: State<'_, AppState>, id: i64, name: String) -> CmdResult<i64> {
  let name = name.trim().to_string();
  if name.is_empty() {
    return Err("Type a name".into());
  }
  let conn = state.db.lock().map_err(err)?;
  let other: Option<i64> = conn.query_row("SELECT id FROM people WHERE name = ?1 AND id != ?2", params![name, id], |r| r.get(0)).optional().map_err(err)?;
  let id = match other {
    Some(o) => {
      conn.execute("UPDATE faces SET person_id = ?1 WHERE person_id = ?2", params![o, id]).map_err(err)?;
      conn.execute("UPDATE OR IGNORE face_rejects SET person_id = ?1 WHERE person_id = ?2", params![o, id]).map_err(err)?;
      conn.execute("DELETE FROM people WHERE id = ?1", [id]).map_err(err)?;
      o
    }
    None => {
      conn.execute("UPDATE people SET name = ?1 WHERE id = ?2", params![name, id]).map_err(err)?;
      id
    }
  };
  bump();
  Ok(id)
}

/// Delete a person album: its name tags are removed and the faces become unnamed again.
#[tauri::command(async)]
pub fn delete_person(state: State<'_, AppState>, id: i64) -> CmdResult<()> {
  let conn = state.db.lock().map_err(err)?;
  conn.execute("UPDATE faces SET person_id = NULL, state = 0, cluster = id WHERE person_id = ?1 AND state IN (1, 2) AND emb IS NOT NULL", [id]).map_err(err)?;
  conn.execute("DELETE FROM faces WHERE person_id = ?1 AND emb IS NULL", [id]).map_err(err)?;
  conn.execute("DELETE FROM people WHERE id = ?1", [id]).map_err(err)?;
  bump();
  Ok(())
}

/// "Set as person's thumbnail".
#[tauri::command(async)]
pub fn set_person_cover(state: State<'_, AppState>, id: i64, face: i64) -> CmdResult<()> {
  let conn = state.db.lock().map_err(err)?;
  conn.execute("UPDATE people SET cover = ?1 WHERE id = ?2", params![face, id]).map_err(err)?;
  Ok(())
}

#[derive(serde::Deserialize)]
pub struct Rect {
  x: f32,
  y: f32,
  w: f32,
  h: f32,
}

/// "Add a person manually": a face drawn on the picture, optionally named.
#[tauri::command(async)]
pub fn add_face(app: AppHandle, state: State<'_, AppState>, photo_id: i64, rect: Rect, name: Option<String>) -> CmdResult<i64> {
  let Rect { x, y, w, h } = rect;
  let id = {
    let conn = state.db.lock().map_err(err)?;
    let person = match name.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
      Some(n) => Some(person_by_name(&conn, n).map_err(err)?),
      None => None,
    };
    conn
      .execute(
        "INSERT INTO faces(photo_id, x, y, w, h, score, person_id, state, source) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?8)",
        params![photo_id, x, y, w, h, person, if person.is_some() { NAMED } else { UNNAMED }, SOURCE_MANUAL],
      )
      .map_err(err)?;
    let id = conn.last_insert_rowid();
    if person.is_none() {
      conn.execute("UPDATE faces SET cluster = ?1 WHERE id = ?1", [id]).map_err(err)?;
    }
    id
  };
  bump();
  let _ = std::fs::remove_file(face_dir(&app).join(format!("{id}.jpg")));
  Ok(id)
}

/// Picture › Reset Faces: forget the faces found (names given are kept) and look again.
#[tauri::command(async)]
pub fn reset_faces(app: AppHandle, state: State<'_, AppState>, ids: Vec<i64>) -> CmdResult<()> {
  {
    let conn = state.db.lock().map_err(err)?;
    let list = ids_sql(&ids);
    conn.execute(&format!("DELETE FROM faces WHERE source = 0 AND state IN (0, 2, 3) AND photo_id IN ({list})"), []).map_err(err)?;
    conn.execute(&format!("UPDATE photos SET faces_done = 0 WHERE id IN ({list})"), []).map_err(err)?;
  }
  bump();
  kick(&app);
  Ok(())
}

#[tauri::command(async)]
pub fn face_progress() -> Progress {
  *PROGRESS.lock().unwrap()
}

/// People Manager › Import from Picasa: read the name tags in every folder's `.picasa.ini`.
#[tauri::command(async)]
pub fn import_picasa_faces(app: AppHandle, state: State<'_, AppState>) -> CmdResult<(usize, usize)> {
  let res = import_picasa(&state.db).map_err(err)?;
  let _ = app.emit("library-changed", ());
  Ok(res)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn likeness_averages_the_closest_three() {
    let a = vec![1.0, 0.0];
    let samples = vec![vec![1.0, 0.0], vec![0.0, 1.0], vec![0.8, 0.6], vec![0.6, 0.8]];
    assert!((likeness(&a, &samples) - 0.8).abs() < 1e-6);
    assert!((likeness(&a, &samples[..1]) - 1.0).abs() < 1e-6);
  }

  #[test]
  fn rotated_rects_stay_inside_the_picture() {
    let r = [0.1, 0.2, 0.3, 0.4];
    for o in [1, 3, 6, 8] {
      let q = rotate_rect(r, o);
      assert!(q.iter().all(|v| (0.0..=1.0).contains(v)));
      assert!((q[2] * q[3] - 0.12).abs() < 1e-6);
    }
    assert_eq!(rotate_rect(r, 6), [0.4, 0.1, 0.4, 0.3]);
  }
}
