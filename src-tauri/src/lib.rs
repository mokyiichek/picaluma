mod commands;
mod db;
mod scanner;
mod thumbs;

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use tauri::Manager;

pub struct AppState {
  pub db: Arc<Mutex<rusqlite::Connection>>,
  pub thumb_dir: PathBuf,
  pub scanning: Arc<AtomicBool>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      let data_dir = app.path().app_data_dir()?;
      std::fs::create_dir_all(&data_dir)?;
      let thumb_dir = data_dir.join("thumbs");
      std::fs::create_dir_all(&thumb_dir)?;
      let conn = db::open(&data_dir.join("library.db"))?;
      log::info!("library at {}", data_dir.display());
      app.manage(AppState {
        db: Arc::new(Mutex::new(conn)),
        thumb_dir,
        scanning: Arc::new(AtomicBool::new(false)),
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
      rayon::spawn(move || responder.respond(thumbs::handle_thumb(&app, &request)));
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
      commands::ui_log,
    ])
    .run(tauri::generate_context!())
    .expect("error while running Picaluma");
}
