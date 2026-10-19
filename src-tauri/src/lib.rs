mod commands;
mod db;
mod fileops;
mod scanner;
mod share;
mod thumbs;

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use tauri::Manager;

pub struct AppState {
  pub db: Arc<Mutex<rusqlite::Connection>>,
  pub thumb_dir: PathBuf,
  pub thumbs: Arc<thumbs::ThumbQueue>,
  pub scanning: Arc<AtomicBool>,
  pub rescan_requested: Arc<AtomicBool>,
  pub warming: Arc<AtomicBool>,
}

/// Logs to stderr and to `picaluma.log` in the library folder (the release app has no console).
/// The previous run's log is kept as `picaluma.old.log`.
fn init_logging(data_dir: &std::path::Path) {
  struct Tee(Option<std::fs::File>);
  impl std::io::Write for Tee {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
      let _ = std::io::stderr().write_all(buf);
      if let Some(f) = &mut self.0 {
        let _ = f.write_all(buf);
      }
      Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
      self.0.as_mut().map_or(Ok(()), |f| f.flush())
    }
  }
  let path = data_dir.join("picaluma.log");
  let _ = std::fs::rename(&path, data_dir.join("picaluma.old.log"));
  let file = std::fs::File::create(&path).ok();
  let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
    .target(env_logger::Target::Pipe(Box::new(Tee(file))))
    .try_init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      // PICALUMA_DATA_DIR points at an alternate library (testing, portable installs).
      let data_dir = match std::env::var_os("PICALUMA_DATA_DIR") {
        Some(dir) => PathBuf::from(dir),
        None => app.path().app_data_dir()?,
      };
      std::fs::create_dir_all(&data_dir)?;
      init_logging(&data_dir);
      let thumb_dir = data_dir.join("thumbs");
      std::fs::create_dir_all(&thumb_dir)?;
      let conn = db::open(&data_dir.join("library.db"))?;
      log::info!("library at {}", data_dir.display());
      // Leave a core free for the UI and the background warmer.
      let workers = std::thread::available_parallelism().map(|n| n.get().saturating_sub(2)).unwrap_or(2).max(2);
      app.manage(AppState {
        db: Arc::new(Mutex::new(conn)),
        thumb_dir,
        thumbs: thumbs::ThumbQueue::start(workers),
        scanning: Arc::new(AtomicBool::new(false)),
        rescan_requested: Arc::new(AtomicBool::new(false)),
        warming: Arc::new(AtomicBool::new(false)),
      });
      scanner::spawn_rescan(app.handle().clone());
      // `maximized` in tauri.conf.json is unreliable on multi-monitor Windows setups.
      if let Some(win) = app.get_webview_window("main") {
        let _ = win.maximize();
      }
      Ok(())
    })
    // Thumbnails and full photos are served over custom schemes so the webview can
    // stream thousands of images without base64 round-trips through IPC.
    .register_asynchronous_uri_scheme_protocol("thumb", |ctx, request, responder| {
      let app = ctx.app_handle().clone();
      rayon::spawn(move || thumbs::handle_thumb(app, request, responder));
    })
    .register_asynchronous_uri_scheme_protocol("photo", |ctx, request, responder| {
      let app = ctx.app_handle().clone();
      std::thread::spawn(move || responder.respond(thumbs::handle_photo(&app, &request)));
    })
    .invoke_handler(tauri::generate_handler![
      commands::library_snapshot,
      commands::list_roots,
      commands::add_root,
      commands::remove_root,
      commands::rescan,
      commands::scan_status,
      commands::picasa_scanlist,
      commands::import_picasa_scanlist,
      commands::search,
      commands::get_photo,
      commands::set_star,
      commands::set_caption,
      commands::set_folder_description,
      commands::set_edits,
      commands::export_picture,
      share::make_export_dir,
      share::copy_into,
      share::email_dir,
      share::email_files,
      share::print_window,
      share::write_text_file,
      share::set_wallpaper,
      fileops::rename_photo,
      commands::ui_log,
      commands::set_tags,
      commands::get_tags,
      commands::suggest,
      commands::open_in_default_app,
      commands::exclude_folder,
      commands::create_album,
      commands::album_add,
      commands::album_remove,
      commands::update_album,
      commands::delete_album,
      fileops::delete_photos,
      fileops::transfer_photos,
      fileops::rename_folder,
      fileops::move_folder,
      fileops::delete_folder,
    ])
    .run(tauri::generate_context!())
    .expect("error while running Picaluma");
}
