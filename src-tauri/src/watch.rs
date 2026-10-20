//! Live watching of the watched folders, like Picasa's "Scan Always": the operating system
//! reports changes (ReadDirectoryChangesW, FSEvents, inotify), and only the folders that changed
//! are listed and indexed again, a moment after a burst of changes settles (a download or a sync
//! writes a file in pieces). No polling, so a 700,000-photo library costs nothing while idle.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{EventKind, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

use crate::scanner::{self, ScanProgress};
use crate::AppState;

/// Quiet time after the last change before rescanning.
const SETTLE: Duration = Duration::from_millis(1500);

#[derive(Default)]
pub struct Watch {
  watcher: Mutex<Option<notify::RecommendedWatcher>>,
  roots: Mutex<Vec<String>>,
  pending: Arc<Mutex<(HashSet<PathBuf>, Option<Instant>)>>,
}

/// Starts the background thread that turns reported changes into folder rescans.
pub fn start(app: &AppHandle) {
  let app = app.clone();
  std::thread::spawn(move || loop {
    std::thread::sleep(Duration::from_millis(500));
    let watch = app.state::<Watch>();
    let ready = {
      let mut p = watch.pending.lock().unwrap();
      match p.1 {
        Some(t) if t.elapsed() >= SETTLE && !scanner::is_scanning(&app) => {
          p.1 = None;
          std::mem::take(&mut p.0)
        }
        _ => HashSet::new(),
      }
    };
    if !ready.is_empty() {
      process(&app, ready);
    }
  });
}

/// (Re)subscribes to the current watched folders. Called at the start of every full scan, so
/// adding or removing a folder takes effect.
pub fn refresh(app: &AppHandle, roots: &[String]) {
  let watch = app.state::<Watch>();
  if *watch.roots.lock().unwrap() == roots {
    return;
  }
  let pending = watch.pending.clone();
  let handler = move |res: notify::Result<notify::Event>| {
    let Ok(ev) = res else { return };
    if matches!(ev.kind, EventKind::Access(_) | EventKind::Other) {
      return;
    }
    let mut p = pending.lock().unwrap();
    p.0.extend(ev.paths);
    p.1 = Some(Instant::now());
  };
  let mut watcher = match notify::recommended_watcher(handler) {
    Ok(w) => w,
    Err(e) => {
      log::warn!("live watching unavailable: {e}");
      return;
    }
  };
  for root in roots {
    match watcher.watch(Path::new(root), RecursiveMode::Recursive) {
      Ok(()) => log::info!("watching {root}"),
      Err(e) => log::warn!("cannot watch {root}: {e} (it is still scanned at start-up and on Rescan)"),
    }
  }
  *watch.watcher.lock().unwrap() = Some(watcher);
  *watch.roots.lock().unwrap() = roots.to_vec();
}

/// Lists the folders the changed paths belong to, then indexes the new pictures.
fn process(app: &AppHandle, paths: HashSet<PathBuf>) {
  let state = app.state::<AppState>();
  if state.scanning.swap(true, Ordering::SeqCst) {
    // A full scan started meanwhile; it will see these changes.
    return;
  }
  let db = state.db.clone();
  let (roots, excluded) = scanner::load_roots(&db);
  let mut dirs: HashSet<PathBuf> = HashSet::new();
  let mut trees: HashSet<PathBuf> = HashSet::new();
  for p in paths {
    if !scanner::is_watched(&p, &roots, &excluded) {
      continue;
    }
    if p.is_dir() {
      trees.insert(p.clone()); // a folder created or moved in: list everything inside
    } else if !scanner::is_image(&p) && p.exists() {
      continue; // other files (partial downloads, documents) don't matter
    } else if !p.exists() && !scanner::is_image(&p) {
      scanner::forget_tree(&db, &p); // a folder removed or moved away
    }
    if let Some(parent) = p.parent() {
      dirs.insert(parent.to_path_buf());
    }
  }
  if dirs.is_empty() && trees.is_empty() {
    state.scanning.store(false, Ordering::SeqCst);
    return;
  }
  let started = Instant::now();
  let mut progress = ScanProgress { scanning: true, phase: "listing".into(), ..Default::default() };
  let _ = app.emit("scan-progress", progress.clone());
  for tree in &trees {
    scanner::list_tree(&db, tree, &excluded);
  }
  for dir in dirs.iter().filter(|d| scanner::is_watched(d, &roots, &excluded)) {
    let _ = scanner::list_folder(&db, dir);
  }
  let _ = app.emit("library-changed", ());
  scanner::index_new(app, &db, &mut progress);
  let _ = app.emit("scan-progress", ScanProgress::default());
  let _ = app.emit("library-changed", ());
  log::info!("live update: {} folders in {:?}", dirs.len() + trees.len(), started.elapsed());
  state.scanning.store(false, Ordering::SeqCst);
  if state.rescan_requested.swap(false, Ordering::SeqCst) {
    scanner::spawn_rescan(app.clone());
  }
}
