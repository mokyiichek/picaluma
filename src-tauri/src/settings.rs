//! App settings that must be known before the window opens (settings.json in the library folder).

use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::formats::FileTypes;
use crate::AppState;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
  /// Draw the window with the graphics card. Off by default: on older PCs a large library's
  /// thumbnails can exhaust a small graphics card, and old drivers then crash Windows
  /// (VIDEO_TDR_FAILURE) instead of recovering. Drawing on the CPU is plenty fast for a photo grid.
  pub hardware_acceleration: bool,
  /// Options › File Types.
  pub file_types: FileTypes,
  /// Options › Name Tags › Enable face recognition (People). On by default, as in Picasa.
  pub face_recognition: bool,
  /// "Not now" on the offer to download the face models: don't ask again at startup.
  pub face_models_declined: bool,
  /// Options › File Types: skip pictures smaller than this many KB (icons, web leftovers). 0 = all.
  pub min_file_kb: u32,
}

impl Default for Settings {
  fn default() -> Self {
    Settings { hardware_acceleration: false, file_types: FileTypes::default(), face_recognition: true, face_models_declined: false, min_file_kb: 0 }
  }
}

pub fn load(dir: &Path) -> Settings {
  // Tolerate a byte-order mark (Notepad and PowerShell add one when editing the file by hand).
  std::fs::read_to_string(dir.join("settings.json"))
    .ok()
    .and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok())
    .unwrap_or_default()
}

fn save(dir: &Path, s: &Settings) -> Result<(), String> {
  let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
  std::fs::write(dir.join("settings.json"), json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
  load(&state.data_dir)
}

/// Options › File Types: saved, applied, and the library rescanned to add or drop those files.
#[tauri::command]
pub fn set_file_types(app: tauri::AppHandle, state: State<'_, AppState>, types: FileTypes) -> Result<(), String> {
  let mut s = load(&state.data_dir);
  if s.file_types != types {
    s.file_types = types;
    save(&state.data_dir, &s)?;
    crate::formats::configure(&types);
    crate::scanner::spawn_rescan(app);
  }
  Ok(())
}

/// Options › File Types › Skip small files: saved, applied, and the library rescanned.
#[tauri::command]
pub fn set_min_file_kb(app: tauri::AppHandle, state: State<'_, AppState>, kb: u32) -> Result<(), String> {
  let mut s = load(&state.data_dir);
  if s.min_file_kb != kb {
    s.min_file_kb = kb;
    save(&state.data_dir, &s)?;
    crate::scanner::set_min_bytes(kb);
    crate::scanner::spawn_rescan(app);
  }
  Ok(())
}

/// Options › Name Tags: turning face recognition on starts finding faces straight away.
#[tauri::command]
pub fn set_face_recognition(app: tauri::AppHandle, state: State<'_, AppState>, on: bool) -> Result<(), String> {
  let mut s = load(&state.data_dir);
  s.face_recognition = on;
  save(&state.data_dir, &s)?;
  if on {
    crate::people::kick(&app);
  }
  Ok(())
}

#[tauri::command]
pub fn set_face_models_declined(state: State<'_, AppState>, declined: bool) -> Result<(), String> {
  let mut s = load(&state.data_dir);
  s.face_models_declined = declined;
  save(&state.data_dir, &s)
}

/// Takes effect the next time Picaluma starts.
#[tauri::command]
pub fn set_hardware_acceleration(state: State<'_, AppState>, on: bool) -> Result<(), String> {
  let mut s = load(&state.data_dir);
  s.hardware_acceleration = on;
  save(&state.data_dir, &s)
}

/// Browser-engine switches for the main window. On Windows (WebView2) software rendering is
/// requested with --disable-gpu; Tauri's own defaults are kept.
#[cfg(windows)]
pub fn browser_args(s: &Settings) -> String {
  let mut args = String::from("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection");
  if !s.hardware_acceleration {
    args.push_str(" --disable-gpu --disable-gpu-compositing");
  }
  args
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn defaults_to_software_rendering_and_round_trips() {
    let dir = std::env::temp_dir().join(format!("picaluma-settings-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let _ = std::fs::remove_file(dir.join("settings.json"));
    assert!(!load(&dir).hardware_acceleration, "graphics card off unless switched on");
    save(&dir, &Settings { hardware_acceleration: true, ..Settings::default() }).unwrap();
    assert!(load(&dir).hardware_acceleration);
    std::fs::write(dir.join("settings.json"), "\u{feff}{\"hardwareAcceleration\": true}").unwrap();
    assert!(load(&dir).hardware_acceleration, "a byte-order mark is ignored");
    std::fs::write(dir.join("settings.json"), "not json").unwrap();
    assert!(!load(&dir).hardware_acceleration, "a broken file falls back to the safe default");
    #[cfg(windows)]
    assert!(browser_args(&Settings::default()).contains("--disable-gpu"));
    let _ = std::fs::remove_dir_all(&dir);
  }
}
