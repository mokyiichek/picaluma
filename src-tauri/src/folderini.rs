//! Edits live with the pictures, the way Picasa kept them: a small text file in each folder
//! (`.picaluma.ini`, one `[file name]` section per picture) records what was done, and the
//! picture itself is never touched. Only **Save** (Ctrl+S) writes the edited picture over the
//! original — after moving the original into a `.picalumaoriginals` subfolder, from which
//! **Undo Save** puts it back. Edits made in Picasa (its `.picasa.ini` and `.picasaoriginals`)
//! are read too.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

pub const INI: &str = ".picaluma.ini";
pub const ORIGINALS: &str = ".picalumaoriginals";
const PICASA_INI: &str = ".picasa.ini";
pub const PICASA_ORIGINALS: &str = ".picasaoriginals";

type Sections = BTreeMap<String, BTreeMap<String, String>>;

fn read(path: &Path) -> Sections {
  let mut out = Sections::new();
  let Ok(bytes) = std::fs::read(path) else { return out };
  let text = String::from_utf8_lossy(&bytes);
  let mut section = String::new();
  for line in text.lines() {
    let line = line.trim_end_matches('\r');
    if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
      section = name.to_string();
      out.entry(section.clone()).or_default();
    } else if let Some((k, v)) = line.split_once('=') {
      if !section.is_empty() {
        out.entry(section.clone()).or_default().insert(k.trim().to_string(), v.to_string());
      }
    }
  }
  out
}

fn write(path: &Path, sections: &Sections) -> std::io::Result<()> {
  let mut text = String::new();
  for (name, keys) in sections.iter().filter(|(_, k)| !k.is_empty()) {
    text.push_str(&format!("[{name}]\r\n"));
    for (k, v) in keys {
      text.push_str(&format!("{k}={v}\r\n"));
    }
  }
  if text.is_empty() {
    // Nothing left to remember: no empty file in the folder.
    return match std::fs::remove_file(path) {
      Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
      _ => Ok(()),
    };
  }
  // Write beside, then swap in, so a crash never leaves half a file.
  let tmp = path.with_extension("ini.tmp");
  std::fs::write(&tmp, text)?;
  hide(&tmp);
  std::fs::rename(&tmp, path)?;
  hide(path);
  Ok(())
}

/// The file is hidden on Windows, like Picasa's (dot files are hidden elsewhere already).
fn hide(path: &Path) {
  #[cfg(windows)]
  {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
      fn SetFileAttributesW(name: *const u16, attrs: u32) -> i32;
    }
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
      SetFileAttributesW(wide.as_ptr(), 0x2);
    }
  }
  #[cfg(not(windows))]
  let _ = path;
}

fn split(photo: &Path) -> Option<(PathBuf, String)> {
  Some((photo.parent()?.to_path_buf(), photo.file_name()?.to_string_lossy().into_owned()))
}

/// Records a picture's edits (`""` = none) in its folder's `.picaluma.ini`.
pub fn save_edits(photo: &Path, edits: &str) -> std::io::Result<()> {
  let Some((dir, name)) = split(photo) else { return Ok(()) };
  let file = dir.join(INI);
  let mut s = read(&file);
  let picasa_edited = read(&dir.join(PICASA_INI)).get(&name).and_then(from_picasa).is_some();
  let entry = s.entry(name).or_default();
  if edits.is_empty() || edits == "[]" {
    // If Picasa had edited it, remember "no edits" explicitly so they don't come back.
    if picasa_edited {
      entry.insert("edits".into(), "[]".into());
    } else {
      entry.remove("edits");
    }
  } else {
    entry.insert("edits".into(), edits.to_string());
  }
  write(&file, &s)
}

/// Whether the folder has any edit file to read (two cheap checks; nothing is downloaded).
pub fn has_edit_files(dir: &Path) -> bool {
  dir.join(INI).is_file() || dir.join(PICASA_INI).is_file()
}

/// Edits recorded for every picture of a folder (keyed by lower-case file name): Picaluma's
/// own, else the ones made in Picasa. "[]" means "no edits".
pub fn folder_edits(dir: &Path) -> BTreeMap<String, String> {
  let mut out = BTreeMap::new();
  for (name, keys) in read(&dir.join(PICASA_INI)) {
    if let Some(e) = from_picasa(&keys) {
      out.insert(name.to_lowercase(), e);
    }
  }
  for (name, keys) in read(&dir.join(INI)) {
    if let Some(e) = keys.get("edits") {
      out.insert(name.to_lowercase(), e.clone());
    }
  }
  out
}

/// The saved original of a picture, if it was saved (by Picaluma, or by Picasa).
pub fn original_of(photo: &Path) -> Option<PathBuf> {
  let (dir, name) = split(photo)?;
  [ORIGINALS, PICASA_ORIGINALS].iter().map(|d| dir.join(d).join(&name)).find(|p| p.is_file())
}

/// **Save**: the original goes into `.picalumaoriginals` (unless an earlier save already kept
/// it), the edited picture takes its place, and the edits are kept with the original so Undo
/// Save can bring them back.
pub fn save_over(photo: &Path, jpeg: &[u8], edits: &str) -> Result<(), String> {
  let (dir, name) = split(photo).ok_or("bad path")?;
  let keep = dir.join(ORIGINALS);
  std::fs::create_dir_all(&keep).map_err(|e| e.to_string())?;
  hide(&keep);
  let backup = keep.join(&name);
  if !backup.exists() && original_of(photo).is_none() {
    std::fs::copy(photo, &backup).map_err(|e| format!("Couldn't keep the original: {e}"))?;
    if let Ok(t) = std::fs::metadata(photo).and_then(|m| m.modified()) {
      if let Ok(f) = std::fs::File::options().write(true).open(&backup) {
        let _ = f.set_modified(t);
      }
    }
  }
  // Remember what was done, beside the original.
  let ini = keep.join(INI);
  let mut s = read(&ini);
  let prev = s.get(&name).and_then(|k| k.get("edits")).cloned();
  let all = merge(prev.as_deref(), edits);
  s.entry(name.clone()).or_default().insert("edits".into(), all);
  write(&ini, &s).map_err(|e| e.to_string())?;
  // Write the new picture beside, then swap it in.
  let tmp = dir.join(format!(".{name}.saving"));
  std::fs::write(&tmp, jpeg).map_err(|e| e.to_string())?;
  std::fs::rename(&tmp, photo).map_err(|e| {
    let _ = std::fs::remove_file(&tmp);
    e.to_string()
  })?;
  save_edits(photo, "").map_err(|e| e.to_string())
}

/// Two edit stacks one after the other (saving again after more edits).
fn merge(before: Option<&str>, after: &str) -> String {
  let mut a: Vec<Value> = before.and_then(|b| serde_json::from_str(b).ok()).unwrap_or_default();
  let b: Vec<Value> = serde_json::from_str(after).unwrap_or_default();
  a.extend(b);
  Value::Array(a).to_string()
}

/// **Undo Save**: the original comes back; returns the edits it had, to edit on from there.
pub fn undo_save(photo: &Path) -> Result<String, String> {
  let original = original_of(photo).ok_or("This picture hasn't been saved, so there is no original to go back to.")?;
  let keep = original.parent().unwrap_or(Path::new(".")).to_path_buf();
  let name = original.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
  let edits = {
    let own = read(&keep.join(INI)).get(&name).and_then(|k| k.get("edits")).cloned();
    own.or_else(|| read(&keep.join(PICASA_INI)).get(&name).and_then(from_picasa)).unwrap_or_default()
  };
  std::fs::copy(&original, photo).map_err(|e| format!("Couldn't restore the original: {e}"))?;
  if let Ok(t) = std::fs::metadata(&original).and_then(|m| m.modified()) {
    if let Ok(f) = std::fs::File::options().write(true).open(photo) {
      let _ = f.set_modified(t);
    }
  }
  std::fs::remove_file(&original).map_err(|e| e.to_string())?;
  for ini_name in [INI, PICASA_INI] {
    let p = keep.join(ini_name);
    let mut s = read(&p);
    if s.remove(&name).is_some() {
      let _ = write(&p, &s);
    }
  }
  // Leave no empty originals folder behind.
  if std::fs::read_dir(&keep).map(|mut d| d.next().is_none()).unwrap_or(false) {
    let _ = std::fs::remove_dir(&keep);
  }
  save_edits(photo, &edits).map_err(|e| e.to_string())?;
  Ok(edits)
}

// ---------------------------------------------------------------------------------------------
// Picasa's edits → Picaluma's
// ---------------------------------------------------------------------------------------------

/// Picasa's `rect64(…)`: left, top, right, bottom as 16-bit fractions → [x, y, w, h].
fn rect64(hex: &str) -> Option<[f64; 4]> {
  let v = u64::from_str_radix(hex.trim(), 16).ok()?;
  let part = |shift: u32| ((v >> shift) & 0xffff) as f64 / 65535.0;
  let (l, t, r, b) = (part(48), part(32), part(16), part(0));
  (r > l && b > t).then_some([l, t, r - l, b - t])
}

/// The edits Picasa recorded for a picture (`filters=`, `rotate=`), as a Picaluma edit stack.
/// Effects Picaluma doesn't have are left out.
pub fn from_picasa(keys: &BTreeMap<String, String>) -> Option<String> {
  let mut out: Vec<Value> = Vec::new();
  if let Some(n) = keys.get("rotate").and_then(|r| r.trim().strip_prefix("rotate(")?.strip_suffix(')')?.parse::<i64>().ok()) {
    if n % 4 != 0 {
      out.push(json!({ "op": "rotate", "v": (n % 4) * 90 }));
    }
  }
  for f in keys.get("filters").map(|s| s.split(';').collect::<Vec<_>>()).unwrap_or_default() {
    let Some((name, args)) = f.split_once('=') else { continue };
    let a: Vec<&str> = args.split(',').collect();
    let num = |i: usize| a.get(i).and_then(|s| s.trim().parse::<f64>().ok());
    let simple = |op: &str| Some(json!({ "op": op }));
    let e = match name.trim() {
      "crop64" => a.get(1).and_then(|h| rect64(h)).map(|r| json!({ "op": "crop", "r": r })),
      // Picasa's tilt is an angle in radians.
      "tilt" => num(1).filter(|v| v.abs() > 1e-6).map(|v| json!({ "op": "straighten", "v": (v.to_degrees() * 100.0).round() / 100.0 })),
      "fill" => num(1).map(|v| json!({ "op": "fillLight", "v": v })),
      "finetune2" => {
        let mut parts = Vec::new();
        for (i, op) in [(1, "fillLight"), (2, "highlights"), (3, "shadows")] {
          if let Some(v) = num(i).filter(|v| v.abs() > 1e-6) {
            parts.push(json!({ "op": op, "v": v }));
          }
        }
        if let Some(v) = num(5).filter(|v| v.abs() > 1e-6) {
          parts.push(json!({ "op": "temp", "v": v }));
        }
        out.extend(parts);
        None
      }
      "unsharp2" => Some(json!({ "op": "sharpen", "v": num(1).unwrap_or(0.5) })),
      "enhance" => simple("lucky"),
      "autolight" => simple("autoContrast"),
      "autocolor" => simple("autoColor"),
      "warm" => simple("warmify"),
      "bw" => simple("bw"),
      "sepia" => simple("sepia"),
      "Vignette" => simple("vignette"),
      "Cinemascope" => simple("cinemascope"),
      "Lomo" => simple("lomo"),
      "CrossProcess" => simple("crossProcess"),
      "Sixties" => simple("sixties"),
      "Boost" => simple("boost"),
      "glow2" => Some(json!({ "op": "glow", "v": num(1).unwrap_or(0.5), "a": num(2).map(|r| (r / 10.0).min(1.0)).unwrap_or(0.5) })),
      _ => None,
    };
    if let Some(e) = e {
      out.push(e);
    }
  }
  (!out.is_empty()).then(|| Value::Array(out).to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn reads_picasa_edits() {
    let mut k = BTreeMap::new();
    k.insert("filters".into(), "tilt=1,0.082961,0.000000;crop64=1,4000400080008000;warm=1;fill=1,0.364486;".into());
    k.insert("rotate".into(), "rotate(1)".into());
    let e: Vec<Value> = serde_json::from_str(&from_picasa(&k).unwrap()).unwrap();
    assert_eq!(e[0]["op"], "rotate");
    assert_eq!(e[0]["v"], 90);
    assert_eq!(e[1]["op"], "straighten");
    assert!((e[1]["v"].as_f64().unwrap() - 4.75).abs() < 0.01);
    assert_eq!(e[2]["op"], "crop");
    assert!((e[2]["r"][0].as_f64().unwrap() - 0.25).abs() < 0.001);
    assert_eq!(e[3]["op"], "warmify");
    assert_eq!(e[4]["op"], "fillLight");
  }

  #[test]
  fn edits_live_in_the_folder_and_save_keeps_the_original() {
    let dir = std::env::temp_dir().join(format!("picaluma-folderini-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let pic = dir.join("IMG_1.jpg");
    std::fs::write(&pic, b"original").unwrap();
    save_edits(&pic, r#"[{"op":"sepia"}]"#).unwrap();
    assert_eq!(folder_edits(&dir)["img_1.jpg"], r#"[{"op":"sepia"}]"#);
    assert_eq!(std::fs::read(&pic).unwrap(), b"original", "edits never touch the picture");

    save_over(&pic, b"edited", r#"[{"op":"sepia"}]"#).unwrap();
    assert_eq!(std::fs::read(&pic).unwrap(), b"edited");
    assert_eq!(std::fs::read(dir.join(ORIGINALS).join("IMG_1.jpg")).unwrap(), b"original");
    assert!(folder_edits(&dir).get("img_1.jpg").is_none(), "after Save the edits are in the picture");

    let back = undo_save(&pic).unwrap();
    assert_eq!(std::fs::read(&pic).unwrap(), b"original");
    assert_eq!(back, r#"[{"op":"sepia"}]"#);
    assert!(!dir.join(ORIGINALS).exists());
    std::fs::remove_dir_all(&dir).ok();
  }
}
