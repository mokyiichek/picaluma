//! Keeps a picture's camera details (EXIF: date taken, camera, exposure…) when Picaluma writes a
//! new JPEG from it (File › Save, Export, Save a Copy, E-mail), as Picasa did. The browser's
//! encoder writes bare JPEGs, so the original's EXIF block is copied in, with:
//! - Orientation set to 1 (the new picture is already upright),
//! - the embedded preview dropped (it would still show the unedited picture),
//! - optionally the GPS position removed (Options › Privacy).

const APP1: u8 = 0xE1;

/// The EXIF payload (starting "Exif\0\0") of a JPEG, if it has one.
fn exif_segment(jpeg: &[u8]) -> Option<(usize, usize)> {
  if jpeg.len() < 4 || jpeg[0] != 0xFF || jpeg[1] != 0xD8 {
    return None;
  }
  let mut i = 2;
  while i + 4 <= jpeg.len() && jpeg[i] == 0xFF {
    let marker = jpeg[i + 1];
    if marker == 0xDA || marker == 0xD9 {
      break; // image data: no more headers
    }
    let len = u16::from_be_bytes([jpeg[i + 2], jpeg[i + 3]]) as usize;
    if len < 2 || i + 2 + len > jpeg.len() {
      return None;
    }
    let body = i + 4;
    if marker == APP1 && jpeg[body..i + 2 + len].starts_with(b"Exif\0\0") {
      return Some((body, i + 2 + len));
    }
    i += 2 + len;
  }
  None
}

struct Tiff<'a> {
  b: &'a mut [u8],
  le: bool,
}

impl Tiff<'_> {
  fn u16(&self, at: usize) -> Option<u16> {
    let s = self.b.get(at..at + 2)?;
    Some(if self.le { u16::from_le_bytes([s[0], s[1]]) } else { u16::from_be_bytes([s[0], s[1]]) })
  }
  fn u32(&self, at: usize) -> Option<u32> {
    let s = self.b.get(at..at + 4)?;
    let a = [s[0], s[1], s[2], s[3]];
    Some(if self.le { u32::from_le_bytes(a) } else { u32::from_be_bytes(a) })
  }
  fn put_u16(&mut self, at: usize, v: u16) {
    if let Some(s) = self.b.get_mut(at..at + 2) {
      s.copy_from_slice(&if self.le { v.to_le_bytes() } else { v.to_be_bytes() });
    }
  }
  fn put_u32(&mut self, at: usize, v: u32) {
    if let Some(s) = self.b.get_mut(at..at + 4) {
      s.copy_from_slice(&if self.le { v.to_le_bytes() } else { v.to_be_bytes() });
    }
  }
}

/// Edits the TIFF block in place (sizes never change). `upright`: set Orientation to 1 and drop
/// the embedded preview; `strip_gps`: empty the GPS directory.
fn patch(tiff: &mut [u8], upright: bool, strip_gps: bool) -> Option<()> {
  let le = match tiff.get(0..2)? {
    b"II" => true,
    b"MM" => false,
    _ => return None,
  };
  let mut t = Tiff { b: tiff, le };
  let ifd0 = t.u32(4)? as usize;
  let n = t.u16(ifd0)? as usize;
  for k in 0..n {
    let e = ifd0 + 2 + k * 12;
    match t.u16(e)? {
      0x0112 if upright => t.put_u16(e + 8, 1),
      0x8825 if strip_gps => {
        // An empty GPS directory: readers find no position.
        let gps = t.u32(e + 8)? as usize;
        t.put_u16(gps, 0);
      }
      _ => {}
    }
  }
  if upright {
    // No next directory: the embedded preview (IFD1) is gone.
    t.put_u32(ifd0 + 2 + n * 12, 0);
  }
  Some(())
}

/// `out` (a freshly encoded JPEG) with the camera details of `original` added.
pub fn transplant(original: &[u8], out: &[u8], strip_gps: bool) -> Vec<u8> {
  let Some((start, end)) = exif_segment(original) else { return out.to_vec() };
  if out.len() < 2 || out[0] != 0xFF || out[1] != 0xD8 || exif_segment(out).is_some() {
    return out.to_vec();
  }
  let mut payload = original[start..end].to_vec();
  if patch(&mut payload[6..], true, strip_gps).is_none() {
    return out.to_vec();
  }
  // After SOI and the JFIF header (APP0), if there is one.
  let mut at = 2;
  if out.len() > 6 && out[2] == 0xFF && out[3] == 0xE0 {
    at = 4 + u16::from_be_bytes([out[4], out[5]]) as usize;
  }
  let len = (payload.len() + 2) as u16;
  let mut v = Vec::with_capacity(out.len() + payload.len() + 4);
  v.extend_from_slice(&out[..at]);
  v.extend_from_slice(&[0xFF, APP1]);
  v.extend_from_slice(&len.to_be_bytes());
  v.extend_from_slice(&payload);
  v.extend_from_slice(&out[at..]);
  v
}

/// Removes the GPS position from a JPEG's EXIF in place (a straight copy for Export / E-mail).
pub fn strip_gps(jpeg: &mut [u8]) {
  if let Some((start, end)) = exif_segment(jpeg) {
    let _ = patch(&mut jpeg[start + 6..end], false, true);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  /// A tiny JPEG header with an EXIF block: Orientation 6 and a GPS directory with one entry.
  fn sample() -> Vec<u8> {
    let mut tiff = b"II*\0\x08\0\0\0".to_vec();
    // IFD0 at 8: two entries, next IFD at 50.
    tiff.extend_from_slice(&2u16.to_le_bytes());
    tiff.extend_from_slice(&[0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0]);
    tiff.extend_from_slice(&[0x25, 0x88, 4, 0, 1, 0, 0, 0, 38, 0, 0, 0]);
    tiff.extend_from_slice(&50u32.to_le_bytes());
    // GPS IFD at 38: one entry.
    tiff.extend_from_slice(&1u16.to_le_bytes());
    tiff.extend_from_slice(&[0, 0, 1, 0, 4, 0, 0, 0, 2, 2, 0, 0]);
    let mut seg = b"Exif\0\0".to_vec();
    seg.extend_from_slice(&tiff);
    let mut j = vec![0xFF, 0xD8, 0xFF, APP1];
    j.extend_from_slice(&((seg.len() + 2) as u16).to_be_bytes());
    j.extend_from_slice(&seg);
    j.extend_from_slice(&[0xFF, 0xDA, 0, 2, 0xFF, 0xD9]);
    j
  }

  #[test]
  fn keeps_exif_upright_without_gps() {
    let fresh = [0xFF, 0xD8, 0xFF, 0xE0, 0, 4, 0, 0, 0xFF, 0xDA, 0, 2, 0xFF, 0xD9];
    let out = transplant(&sample(), &fresh, true);
    let (s, _) = exif_segment(&out).expect("exif copied");
    let tiff = &out[s + 6..];
    assert_eq!(tiff[8 + 2 + 8], 1, "orientation reset");
    assert_eq!(u16::from_le_bytes([tiff[38], tiff[39]]), 0, "gps emptied");
    assert_eq!(&out[2..4], &[0xFF, 0xE0], "JFIF header stays first");
  }

  #[test]
  fn strip_in_place() {
    let mut j = sample();
    strip_gps(&mut j);
    let (s, _) = exif_segment(&j).unwrap();
    assert_eq!(u16::from_le_bytes([j[s + 6 + 38], j[s + 6 + 39]]), 0);
    assert_eq!(j[s + 6 + 8 + 2 + 8], 6, "orientation untouched on a straight copy");
  }
}
