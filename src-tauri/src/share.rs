//! Export, E-mail and Print support: export folders, attachments handed to the user's mail
//! program, and the native print dialog on macOS.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
  e.to_string()
}

/// Creates `<location>/<name>` for Export (Picasa makes a new folder per export), adding
/// " (2)", " (3)"… if it already exists. Returns the created folder.
#[tauri::command]
pub fn make_export_dir(location: String, name: String) -> CmdResult<String> {
  let name = sanitize(&name);
  let dir = unique_dir(Path::new(&location), if name.is_empty() { "Exported Pictures" } else { &name });
  std::fs::create_dir_all(&dir).map_err(err)?;
  Ok(dir.to_string_lossy().into_owned())
}

/// Copies an original file into `dir` unchanged (keeps EXIF), never overwriting. Returns the new path.
#[tauri::command]
pub fn copy_into(src: String, dir: String) -> CmdResult<String> {
  let src = PathBuf::from(src);
  let name = src.file_name().map(|n| n.to_string_lossy().into_owned()).ok_or("bad file name")?;
  std::fs::create_dir_all(&dir).map_err(err)?;
  let target = crate::fileops::unique_target(Path::new(&dir), name);
  std::fs::copy(&src, &target).map_err(err)?;
  Ok(target.to_string_lossy().into_owned())
}

/// Writes a text file (Export as HTML Page), creating its folder.
#[tauri::command]
pub fn write_text_file(path: String, text: String) -> CmdResult<()> {
  if let Some(dir) = Path::new(&path).parent() {
    std::fs::create_dir_all(dir).map_err(err)?;
  }
  std::fs::write(path, text).map_err(err)
}

/// Create › Set as Desktop: copies the rendered picture to the app data folder (so it survives
/// the original being moved) and makes it the desktop background.
#[tauri::command]
pub fn set_wallpaper(app: AppHandle, data_base64: String) -> CmdResult<()> {
  use base64::Engine;
  let bytes = base64::engine::general_purpose::STANDARD.decode(data_base64.as_bytes()).map_err(err)?;
  let dir = app.path().app_data_dir().map_err(err)?;
  std::fs::create_dir_all(&dir).map_err(err)?;
  // A new name each time: macOS and some Linux desktops cache the picture by path.
  let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
  if let Ok(entries) = std::fs::read_dir(&dir) {
    for e in entries.flatten() {
      if e.file_name().to_string_lossy().starts_with("desktop-") {
        let _ = std::fs::remove_file(e.path());
      }
    }
  }
  let file = dir.join(format!("desktop-{stamp}.jpg"));
  std::fs::write(&file, bytes).map_err(err)?;
  apply_wallpaper(&file)
}

#[cfg(windows)]
fn apply_wallpaper(file: &Path) -> CmdResult<()> {
  #[link(name = "user32")]
  extern "system" {
    fn SystemParametersInfoW(action: u32, param: u32, pv: *mut std::ffi::c_void, win_ini: u32) -> i32;
  }
  const SPI_SETDESKWALLPAPER: u32 = 0x0014;
  const SPIF_UPDATEINIFILE: u32 = 0x01;
  const SPIF_SENDCHANGE: u32 = 0x02;
  let mut wide: Vec<u16> = file.to_string_lossy().encode_utf16().chain(Some(0)).collect();
  let ok = unsafe { SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, wide.as_mut_ptr().cast(), SPIF_UPDATEINIFILE | SPIF_SENDCHANGE) };
  if ok != 0 { Ok(()) } else { Err("Windows did not accept the picture".into()) }
}

#[cfg(target_os = "macos")]
fn apply_wallpaper(file: &Path) -> CmdResult<()> {
  let path = file.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"");
  let script = format!("tell application \"System Events\" to tell every desktop to set picture to POSIX file \"{path}\"");
  let ok = std::process::Command::new("osascript").args(["-e", &script]).status().map_err(err)?.success();
  if ok { Ok(()) } else { Err("macOS did not allow changing the desktop picture".into()) }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn apply_wallpaper(file: &Path) -> CmdResult<()> {
  // GNOME, Cinnamon, Budgie and Unity use org.gnome.desktop.background; KDE has its own tool.
  let uri = format!("file://{}", file.to_string_lossy());
  let mut ok = false;
  for key in ["picture-uri", "picture-uri-dark"] {
    ok |= std::process::Command::new("gsettings")
      .args(["set", "org.gnome.desktop.background", key, &uri])
      .status()
      .map(|s| s.success())
      .unwrap_or(false);
  }
  if !ok {
    ok = std::process::Command::new("plasma-apply-wallpaperimage").arg(file).status().map(|s| s.success()).unwrap_or(false);
  }
  if ok { Ok(()) } else { Err("this desktop doesn't support changing the background from apps".into()) }
}

/// A fresh folder in the app cache for e-mail attachments. Folders older than a day are removed.
#[tauri::command]
pub fn email_dir(app: AppHandle) -> CmdResult<String> {
  let base = app.path().app_cache_dir().map_err(err)?.join("email");
  if let Ok(entries) = std::fs::read_dir(&base) {
    let day_ago = SystemTime::now() - Duration::from_secs(86_400);
    for e in entries.flatten() {
      if e.metadata().and_then(|m| m.modified()).map(|t| t < day_ago).unwrap_or(false) {
        let _ = std::fs::remove_dir_all(e.path());
      }
    }
  }
  let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
  let dir = base.join(stamp.to_string());
  std::fs::create_dir_all(&dir).map_err(err)?;
  Ok(dir.to_string_lossy().into_owned())
}

/// Opens a new message in the user's mail program with `paths` attached. Errors when no mail
/// program can take attachments; the UI then shows the files in a folder instead.
#[tauri::command]
pub async fn email_files(paths: Vec<String>, subject: String) -> CmdResult<()> {
  tauri::async_runtime::spawn_blocking(move || send_mail(&paths, &subject)).await.map_err(err)?
}

/// Native print dialog for the window. WebView2 and WebKitGTK print through `window.print()`;
/// WKWebView on macOS ignores it, so the UI calls this there.
#[tauri::command]
pub fn print_window(window: tauri::WebviewWindow) -> CmdResult<()> {
  window.print().map_err(err)
}

fn sanitize(name: &str) -> String {
  name.trim().chars().map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c }).collect()
}

fn unique_dir(location: &Path, name: &str) -> PathBuf {
  let first = location.join(name);
  if !first.exists() {
    return first;
  }
  (2..).map(|n| location.join(format!("{name} ({n})"))).find(|c| !c.exists()).unwrap()
}

#[cfg(target_os = "macos")]
fn send_mail(paths: &[String], _subject: &str) -> CmdResult<()> {
  // `open -a Mail files…` starts a new Mail message with the files attached.
  let ok = std::process::Command::new("open").args(["-a", "Mail"]).args(paths).status().map_err(err)?.success();
  if ok { Ok(()) } else { Err("Mail could not be opened".into()) }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn send_mail(paths: &[String], subject: &str) -> CmdResult<()> {
  let mut cmd = std::process::Command::new("xdg-email");
  cmd.args(["--subject", subject]);
  for p in paths {
    cmd.args(["--attach", p]);
  }
  let ok = cmd.status().map_err(|e| format!("xdg-email: {e}"))?.success();
  if ok { Ok(()) } else { Err("no mail program is set up".into()) }
}

#[cfg(windows)]
fn send_mail(paths: &[String], subject: &str) -> CmdResult<()> {
  mapi::send(paths, subject)
}

/// Simple MAPI: the standard way Windows desktop apps hand attachments to the default mail
/// program (Outlook, Thunderbird, eM Client…).
#[cfg(windows)]
mod mapi {
  use std::ffi::c_void;
  use std::path::Path;

  #[repr(C)]
  struct MapiFileDescW {
    ul_reserved: u32,
    fl_flags: u32,
    n_position: u32,
    path_name: *const u16,
    file_name: *const u16,
    file_type: *const c_void,
  }

  #[repr(C)]
  struct MapiMessageW {
    ul_reserved: u32,
    subject: *const u16,
    note_text: *const u16,
    message_type: *const u16,
    date_received: *const u16,
    conversation_id: *const u16,
    fl_flags: u32,
    originator: *const c_void,
    recip_count: u32,
    recips: *const c_void,
    file_count: u32,
    files: *const MapiFileDescW,
  }

  type SendMailW = unsafe extern "system" fn(usize, usize, *const MapiMessageW, u32, u32) -> u32;

  #[link(name = "kernel32")]
  extern "system" {
    fn LoadLibraryW(name: *const u16) -> *mut c_void;
    fn GetProcAddress(module: *mut c_void, name: *const std::ffi::c_char) -> *mut c_void;
  }

  #[link(name = "advapi32")]
  extern "system" {
    fn RegGetValueW(key: isize, sub_key: *const u16, value: *const u16, flags: u32, kind: *mut u32, data: *mut c_void, size: *mut u32) -> i32;
  }

  const MAPI_LOGON_UI: u32 = 0x1;
  const MAPI_DIALOG: u32 = 0x8;
  const MAPI_USER_ABORT: u32 = 1;
  const HKEY_CURRENT_USER: isize = 0x8000_0001u32 as i32 as isize;
  const HKEY_LOCAL_MACHINE: isize = 0x8000_0002u32 as i32 as isize;
  const RRF_RT_REG_SZ: u32 = 0x2;

  fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
  }

  /// The registered default mail program (`Software\Clients\Mail`), if any.
  fn default_client() -> Option<String> {
    let key = wide(r"Software\Clients\Mail");
    for root in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
      let mut buf = [0u16; 260];
      let mut size = (buf.len() * 2) as u32;
      let rc = unsafe { RegGetValueW(root, key.as_ptr(), std::ptr::null(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut size) };
      if rc == 0 {
        let len = buf.iter().position(|&c| c == 0).unwrap_or(0);
        let name = String::from_utf16_lossy(&buf[..len]);
        if !name.trim().is_empty() {
          return Some(name);
        }
      }
    }
    None
  }

  pub fn send(paths: &[String], subject: &str) -> Result<(), String> {
    let client = default_client().ok_or("no default mail program is set up")?;
    log::info!("e-mail via MAPI client {client}");
    let send: SendMailW = unsafe {
      let dll = LoadLibraryW(wide("mapi32.dll").as_ptr());
      if dll.is_null() {
        return Err("mapi32.dll is missing".into());
      }
      let f = GetProcAddress(dll, c"MAPISendMailW".as_ptr());
      if f.is_null() {
        return Err("MAPISendMailW is unavailable".into());
      }
      std::mem::transmute::<*mut c_void, SendMailW>(f)
    };
    let names: Vec<(Vec<u16>, Vec<u16>)> = paths
      .iter()
      .map(|p| (wide(p), wide(&Path::new(p).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default())))
      .collect();
    let files: Vec<MapiFileDescW> = names
      .iter()
      .map(|(path, name)| MapiFileDescW {
        ul_reserved: 0,
        fl_flags: 0,
        n_position: u32::MAX,
        path_name: path.as_ptr(),
        file_name: name.as_ptr(),
        file_type: std::ptr::null(),
      })
      .collect();
    let subject = wide(subject);
    let msg = MapiMessageW {
      ul_reserved: 0,
      subject: subject.as_ptr(),
      note_text: std::ptr::null(),
      message_type: std::ptr::null(),
      date_received: std::ptr::null(),
      conversation_id: std::ptr::null(),
      fl_flags: 0,
      originator: std::ptr::null(),
      recip_count: 0,
      recips: std::ptr::null(),
      file_count: files.len() as u32,
      files: files.as_ptr(),
    };
    match unsafe { send(0, 0, &msg, MAPI_LOGON_UI | MAPI_DIALOG, 0) } {
      0 | MAPI_USER_ABORT => Ok(()),
      code => Err(format!("{client} could not start a message (MAPI error {code})")),
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn export_dir_is_unique_and_sanitized() {
    let base = std::env::temp_dir().join(format!("picaluma-share-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(&base).unwrap();
    let loc = base.to_string_lossy().into_owned();
    let a = make_export_dir(loc.clone(), "Trip: Day 1".into()).unwrap();
    let b = make_export_dir(loc.clone(), "Trip: Day 1".into()).unwrap();
    let c = make_export_dir(loc, "  ".into()).unwrap();
    assert_eq!(Path::new(&a), base.join("Trip_ Day 1"));
    assert_eq!(Path::new(&b), base.join("Trip_ Day 1 (2)"));
    assert_eq!(Path::new(&c), base.join("Exported Pictures"));
    assert!(Path::new(&b).is_dir());
    let _ = std::fs::remove_dir_all(&base);
  }
}
