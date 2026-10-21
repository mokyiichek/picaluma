//! Reading the name tags Picasa left in each folder's `.picasa.ini` (interoperability with the
//! user's own data; no Picasa code is involved):
//!
//! ```text
//! [Contacts2]
//! 1c42798ca1ef45e3=Father;;
//! [DSC_0984.JPG]
//! faces=rect64(320b29164ee45ced),1c42798ca1ef45e3;rect64(…),…
//! ```
//!
//! `rect64` packs left, top, right and bottom as 16-bit fractions of the picture.

use std::collections::HashMap;
use std::path::Path;

/// A face rectangle ([x, y, w, h] fractions) with its Picasa contact id.
pub type Tag = ([f32; 4], String);

#[derive(Default, Debug)]
pub struct Ini {
  /// File name → its tagged faces.
  pub faces: Vec<(String, Vec<Tag>)>,
  /// Contact id → name.
  pub contacts: HashMap<String, String>,
}

pub fn read_ini(dir: &Path) -> Ini {
  let mut ini = Ini::default();
  let Ok(text) = std::fs::read(dir.join(".picasa.ini")) else { return ini };
  let text = String::from_utf8_lossy(&text);
  let mut section = String::new();
  for line in text.lines() {
    let line = line.trim();
    if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
      section = name.to_string();
      continue;
    }
    let Some((key, value)) = line.split_once('=') else { continue };
    if section == "Contacts2" {
      let name = value.split(';').next().unwrap_or("").trim();
      if !name.is_empty() {
        ini.contacts.insert(key.trim().to_string(), name.to_string());
      }
    } else if key == "faces" && !section.is_empty() {
      let rects: Vec<_> = value.split(';').filter_map(parse_face).collect();
      if !rects.is_empty() {
        ini.faces.push((section.clone(), rects));
      }
    }
  }
  ini
}

/// `rect64(320b29164ee45ced),1c42798ca1ef45e3` → rectangle and contact id. Untagged faces
/// (contact `ffffffffffffffff`) are skipped: Picaluma finds faces itself.
fn parse_face(entry: &str) -> Option<Tag> {
  let (rect, contact) = entry.split_once(',')?;
  let contact = contact.trim();
  if contact.is_empty() || contact.chars().all(|c| c == 'f') {
    return None;
  }
  let hex = rect.trim().strip_prefix("rect64(")?.strip_suffix(')')?;
  let v = u64::from_str_radix(hex, 16).ok()?;
  let part = |shift: u32| ((v >> shift) & 0xffff) as f32 / 65535.0;
  let (l, t, r, b) = (part(48), part(32), part(16), part(0));
  (r > l && b > t).then(|| ([l, t, r - l, b - t], contact.to_string()))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn reads_name_tags() {
    let dir = std::env::temp_dir().join(format!("picaluma-ini-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
      dir.join(".picasa.ini"),
      "[Contacts2]\r\nabc123=Grandma;;\r\n[IMG_1.JPG]\r\nfaces=rect64(4000400080008000),abc123;rect64(1000100020002000),ffffffffffffffff\r\nstar=yes\r\n",
    )
    .unwrap();
    let ini = read_ini(&dir);
    assert_eq!(ini.contacts["abc123"], "Grandma");
    assert_eq!(ini.faces.len(), 1);
    let (file, rects) = &ini.faces[0];
    assert_eq!(file, "IMG_1.JPG");
    assert_eq!(rects.len(), 1);
    assert!((rects[0].0[0] - 0.25).abs() < 0.001 && (rects[0].0[2] - 0.25).abs() < 0.001);
    std::fs::remove_dir_all(&dir).ok();
  }
}
