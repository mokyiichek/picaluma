//! Help › About: update to the latest release. The website's downloads are the GitHub release
//! files, checked here against the SHA-256 GitHub lists for them. Only the program is replaced:
//! the library and settings live in the user's data folder, which an update never touches.

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

type CmdResult<T> = Result<T, String>;

const LATEST: &str = "https://api.github.com/repos/mokyiichek/picaluma/releases/latest";
const DOWNLOADS: &str = "https://github.com/mokyiichek/picaluma/releases/download/";

/// Installed copies on Windows and Mac replace themselves; elsewhere the website takes over.
const CAN_INSTALL: bool = cfg!(all(not(debug_assertions), any(windows, target_os = "macos")));

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
  current: String,
  latest: String,
  newer: bool,
  can_install: bool,
}

struct Asset {
  name: String,
  url: String,
  sha256: String,
  size: u64,
}

fn parts(v: &str) -> Vec<u64> {
  v.trim_start_matches('v').split('.').map(|p| p.parse().unwrap_or(0)).collect()
}

fn newer(latest: &str, current: &str) -> bool {
  parts(latest) > parts(current)
}

fn latest_release() -> CmdResult<(String, Vec<Asset>)> {
  let resp = ureq::get(LATEST).timeout(Duration::from_secs(20)).set("Accept", "application/vnd.github+json").call().map_err(|e| match e {
    ureq::Error::Status(403 | 429, _) => "GitHub is busy. Please try again later.".to_string(),
    other => other.to_string(),
  })?;
  let json: Value = serde_json::from_str(&resp.into_string().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
  let tag = json["tag_name"].as_str().ok_or("The latest release has no version.")?.to_string();
  let assets = json["assets"]
    .as_array()
    .map(|list| {
      list
        .iter()
        .filter_map(|a| {
          Some(Asset {
            name: a["name"].as_str()?.to_string(),
            url: a["browser_download_url"].as_str().filter(|u| u.starts_with(DOWNLOADS))?.to_string(),
            sha256: a["digest"].as_str()?.strip_prefix("sha256:")?.to_lowercase(),
            size: a["size"].as_u64()?,
          })
        })
        .collect()
    })
    .unwrap_or_default();
  Ok((tag, assets))
}

fn wanted(name: &str) -> bool {
  if cfg!(target_os = "macos") {
    name.ends_with(".app.tar.gz")
  } else if cfg!(all(windows, target_arch = "x86")) {
    name.ends_with("_x86-setup.exe")
  } else if cfg!(windows) {
    name.ends_with("_x64-setup.exe")
  } else {
    false
  }
}

fn download(app: &AppHandle, asset: &Asset, dir: &Path) -> CmdResult<PathBuf> {
  let agent = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(20)).timeout_read(Duration::from_secs(60)).build();
  let resp = agent.get(&asset.url).call().map_err(|e| e.to_string())?;
  let part = dir.join(format!("{}.part", asset.name));
  let mut out = std::fs::File::create(&part).map_err(|e| e.to_string())?;
  let mut body = resp.into_reader();
  let mut hasher = Sha256::new();
  let mut buf = vec![0u8; 256 * 1024];
  let (mut done, mut shown) = (0u64, 0u64);
  loop {
    let n = body.read(&mut buf).map_err(|e| e.to_string())?;
    if n == 0 {
      break;
    }
    hasher.update(&buf[..n]);
    out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
    done += n as u64;
    let pct = done * 100 / asset.size.max(1);
    if pct != shown {
      shown = pct;
      let _ = app.emit("update-progress", pct);
    }
  }
  out.flush().map_err(|e| e.to_string())?;
  drop(out);
  let hash: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
  if done != asset.size || hash != asset.sha256 {
    let _ = std::fs::remove_file(&part);
    return Err("The download was damaged. Please try again.".into());
  }
  let file = dir.join(&asset.name);
  std::fs::rename(&part, &file).map_err(|e| e.to_string())?;
  Ok(file)
}

/// Starts the installer the same way Tauri's own updater does: `/UPDATE` keeps the user's shortcuts
/// and skips the uninstall, `/R` starts the new version when it's done.
#[cfg(windows)]
fn apply(file: &Path) -> CmdResult<()> {
  use std::os::windows::process::CommandExt;
  const CREATE_NO_WINDOW: u32 = 0x0800_0000;
  std::process::Command::new(file).args(["/S", "/UPDATE", "/R"]).creation_flags(CREATE_NO_WINDOW).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Swaps the app bundle for the new one (the running program keeps its open files), and opens the
/// new one once this one has gone. Any failure puts the old bundle back.
#[cfg(target_os = "macos")]
fn apply(file: &Path) -> CmdResult<()> {
  use std::process::Command;
  let exe = std::env::current_exe().map_err(|e| e.to_string())?;
  let bundle = exe.ancestors().nth(3).filter(|p| p.extension().is_some_and(|x| x == "app")).ok_or("Picaluma isn't running from an app bundle.")?.to_path_buf();
  let shown = bundle.to_string_lossy();
  if shown.contains("/AppTranslocation/") || shown.starts_with("/Volumes/") {
    return Err("Move Picaluma to the Applications folder first.".into());
  }
  let parent = bundle.parent().ok_or("Picaluma has no parent folder.")?;
  let work = parent.join(".picaluma-update");
  let _ = std::fs::remove_dir_all(&work);
  std::fs::create_dir_all(&work).map_err(|_| "Picaluma isn't allowed to replace itself in that folder.".to_string())?;
  let run = |cmd: &mut Command| -> CmdResult<()> {
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
      Ok(())
    } else {
      Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
  };
  let result = (|| -> CmdResult<()> {
    run(Command::new("/usr/bin/tar").arg("-xzf").arg(file).arg("-C").arg(&work))?;
    let new = std::fs::read_dir(&work).map_err(|e| e.to_string())?.flatten().map(|e| e.path()).find(|p| p.extension().is_some_and(|x| x == "app")).ok_or("The download has no app in it.")?;
    // Signed by a Developer ID and notarized by Apple, or it doesn't go in.
    run(Command::new("/usr/bin/codesign").args(["--verify", "--deep", "--strict"]).arg(&new))?;
    run(Command::new("/usr/sbin/spctl").args(["-a", "-t", "exec"]).arg(&new))?;
    let old = work.join("previous.app.old");
    std::fs::rename(&bundle, &old).map_err(|_| "Picaluma isn't allowed to replace itself in that folder.".to_string())?;
    if let Err(e) = std::fs::rename(&new, &bundle) {
      let _ = std::fs::rename(&old, &bundle);
      return Err(e.to_string());
    }
    Ok(())
  })();
  if let Err(e) = result {
    let _ = std::fs::remove_dir_all(&work);
    return Err(e);
  }
  Command::new("/bin/sh")
    .args(["-c", r#"while kill -0 "$0" 2>/dev/null; do sleep 0.2; done; /usr/bin/open "$1"; rm -rf "$2""#])
    .arg(std::process::id().to_string())
    .arg(&bundle)
    .arg(&work)
    .spawn()
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[cfg(not(any(windows, target_os = "macos")))]
fn apply(_file: &Path) -> CmdResult<()> {
  Err("Please update from the website.".into())
}

#[tauri::command(async)]
pub fn update_check(app: AppHandle) -> CmdResult<UpdateInfo> {
  let current = app.package_info().version.to_string();
  let (tag, assets) = latest_release()?;
  Ok(UpdateInfo {
    newer: newer(&tag, &current),
    can_install: CAN_INSTALL && assets.iter().any(|a| wanted(&a.name)),
    latest: tag.trim_start_matches('v').to_string(),
    current,
  })
}

#[tauri::command(async)]
pub fn update_install(app: AppHandle) -> CmdResult<()> {
  if !CAN_INSTALL {
    return Err("Please update from the website.".into());
  }
  let (tag, assets) = latest_release()?;
  if !newer(&tag, &app.package_info().version.to_string()) {
    return Err("You already have the latest version.".into());
  }
  let asset = assets.iter().find(|a| wanted(&a.name)).ok_or("There's no download for this computer.")?;
  let dir = std::env::temp_dir().join("picaluma-update");
  let _ = std::fs::remove_dir_all(&dir);
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let file = download(&app, asset, &dir)?;
  log::info!("updating to {tag}");
  apply(&file)?;
  app.exit(0);
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn compares_versions_as_numbers() {
    assert!(newer("v0.7.29", "0.7.28"));
    assert!(newer("v0.7.100", "0.7.28"));
    assert!(newer("v0.8.0", "0.7.28"));
    assert!(!newer("v0.7.28", "0.7.28"));
    assert!(!newer("v0.7.9", "0.7.28"));
  }
}
