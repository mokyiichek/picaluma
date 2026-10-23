mod commands;
mod db;
mod fileops;
mod faces;
mod importer;
mod formats;
mod people;
mod picasa;
mod scanner;
mod settings;
mod share;
mod sysimg;
mod thumbs;
mod watch;

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
  /// The library folder (library.db, thumbs, settings.json, picaluma.log).
  pub data_dir: PathBuf,
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
      // File Types must be known before the first scan, or it would drop those files.
      formats::configure(&settings::load(&data_dir).file_types);
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
        data_dir: data_dir.clone(),
      });
      app.manage(watch::Watch::default());
      watch::start(app.handle());
      scanner::spawn_rescan(app.handle().clone());
      // The window is created here rather than in tauri.conf.json so the graphics setting can be
      // applied before the browser engine starts.
      let prefs = settings::load(&data_dir);
      log::info!("hardware acceleration: {}", if prefs.hardware_acceleration { "on" } else { "off (drawing on the CPU)" });
      #[cfg(target_os = "linux")]
      if !prefs.hardware_acceleration {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
      }
      #[allow(unused_mut)]
      let mut window = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
        .title("Picaluma")
        .inner_size(1440.0, 900.0)
        .min_inner_size(960.0, 600.0)
        .maximized(true);
      #[cfg(windows)]
      {
        window = window.additional_browser_args(&settings::browser_args(&prefs));
      }
      let win = window.build()?;
      #[cfg(windows)]
      set_taskbar_icon(&win);
      // `maximized` alone is unreliable on multi-monitor Windows setups.
      let _ = win.maximize();
      Ok(())
    })
    // Thumbnails and full photos are served over custom schemes so the webview can
    // stream thousands of images without base64 round-trips through IPC.
    .register_asynchronous_uri_scheme_protocol("thumb", |ctx, request, responder| {
      let app = ctx.app_handle().clone();
      rayon::spawn(move || thumbs::handle_thumb(app, request, responder));
    })
    .register_asynchronous_uri_scheme_protocol("face", |ctx, request, responder| {
      let app = ctx.app_handle().clone();
      rayon::spawn(move || responder.respond(people::handle_face(&app, &request)));
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
      commands::prioritize_folder,
      commands::set_sort,
      commands::set_folder_props,
      commands::write_bytes,
      commands::allow_media,
      commands::list_dirs,
      commands::apply_folder_manager,
      commands::add_project,
      commands::update_project,
      commands::photos_since,
      commands::set_hidden,
      commands::places,
      importer::import_sources,
      importer::scan_import,
      importer::import_default_dest,
      importer::import_files,
      settings::set_face_recognition,
      people::faces_in_photo,
      people::person_faces,
      people::unnamed_groups,
      people::name_faces,
      people::confirm_faces,
      people::reject_faces,
      people::ignore_faces,
      people::rename_person,
      people::delete_person,
      people::set_person_cover,
      people::add_face,
      people::reset_faces,
      people::face_progress,
      people::import_picasa_faces,
      people::face_models_status,
      people::download_face_models,
      settings::set_face_models_declined,
      share::make_export_dir,
      share::copy_into,
      share::email_dir,
      share::email_files,
      share::print_window,
      settings::get_settings,
      settings::set_hardware_acceleration,
      settings::set_file_types,
      share::write_text_file,
      share::set_wallpaper,
      fileops::rename_photo,
      fileops::remove_empty_folder,
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

/// A window built in code gets only the small (title bar) icon, so the taskbar and Alt+Tab
/// showed a blank generic icon. Give it the large icon embedded in the program file.
#[cfg(windows)]
fn set_taskbar_icon(win: &tauri::WebviewWindow) {
  use std::os::windows::ffi::OsStrExt;
  use windows::core::PCWSTR;
  use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
  use windows::Win32::UI::Shell::ExtractIconExW;
  use windows::Win32::UI::WindowsAndMessaging::{SendMessageW, HICON, ICON_BIG, WM_SETICON};
  let (Ok(hwnd), Ok(exe)) = (win.hwnd(), std::env::current_exe()) else { return };
  let wide: Vec<u16> = exe.as_os_str().encode_wide().chain(Some(0)).collect();
  let mut large = HICON::default();
  unsafe {
    if ExtractIconExW(PCWSTR(wide.as_ptr()), 0, Some(&mut large), None, 1) > 0 && !large.is_invalid() {
      SendMessageW(HWND(hwnd.0 as _), WM_SETICON, Some(WPARAM(ICON_BIG as usize)), Some(LPARAM(large.0 as isize)));
    }
  }
}
