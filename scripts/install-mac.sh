#!/bin/bash
# Picaluma installer for macOS: downloads the latest release, installs it in /Applications and
# opens it. Files downloaded with curl aren't quarantined, so macOS doesn't block the app.
# If Picaluma doesn't stay open, a report is saved to the Desktop and copied to the clipboard.
#
#   curl -fsSL https://ahmok.com/picaluma/install.sh | bash
set -uo pipefail
REPO="mokyiichek/picaluma"
APP="/Applications/Picaluma.app"
TMP="$(mktemp -d)"
cleanup() { hdiutil detach "$TMP/mnt" -quiet 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT
fail() { echo "✗ $1"; exit 1; }

echo "→ Finding the latest Picaluma release…"
URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -o '"browser_download_url": *"[^"]*\.dmg"' | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')
[ -n "$URL" ] || fail "Couldn't find the macOS download. Check your internet connection."

echo "→ Downloading $(basename "$URL")…"
curl -fL --progress-bar -o "$TMP/Picaluma.dmg" "$URL" || fail "Download failed."

echo "→ Installing to /Applications…"
pkill -f "$APP/Contents/MacOS/" 2>/dev/null
hdiutil attach "$TMP/Picaluma.dmg" -nobrowse -readonly -mountpoint "$TMP/mnt" -quiet \
  || fail "Couldn't open the disk image."
SUDO=""
[ -w /Applications ] || { SUDO="sudo"; echo "  (your Mac password is needed to write to /Applications)"; }
$SUDO rm -rf "$APP"
$SUDO ditto "$TMP/mnt/Picaluma.app" "$APP" || fail "Couldn't copy Picaluma to /Applications."
hdiutil detach "$TMP/mnt" -quiet
$SUDO xattr -dr com.apple.quarantine "$APP" 2>/dev/null

echo "→ Opening Picaluma…"
open "$APP"
for _ in 1 2 3 4 5 6; do
  sleep 1
  pgrep -f "$APP/Contents/MacOS/" >/dev/null && { echo "✓ Picaluma $(defaults read "$APP/Contents/Info" CFBundleShortVersionString 2>/dev/null) is installed and running."; exit 0; }
done

echo "✗ Picaluma didn't stay open. Collecting details…"
BIN="$(defaults read "$APP/Contents/Info" CFBundleExecutable 2>/dev/null)"
REPORT="$HOME/Desktop/picaluma-mac-report.txt"
{
  echo "Picaluma $(defaults read "$APP/Contents/Info" CFBundleShortVersionString 2>/dev/null)"
  echo "macOS $(sw_vers -productVersion) ($(sw_vers -buildVersion)) on $(uname -m)"
  echo; echo "--- signature ---"
  codesign -dv "$APP" 2>&1 | grep -E "Identifier|Format|Signature|TeamIdentifier"
  codesign --verify --deep --strict "$APP" 2>&1 && echo "codesign: valid"
  spctl -a -t exec -vv "$APP" 2>&1
  echo; echo "--- extended attributes ---"
  xattr -l "$APP" 2>&1
  echo; echo "--- running the app directly for 10 s ---"
  "$APP/Contents/MacOS/$BIN" >"$TMP/run.log" 2>&1 &
  PID=$!; sleep 10; kill "$PID" 2>/dev/null
  tail -60 "$TMP/run.log"
  echo; echo "--- latest crash report ---"
  CRASH="$(ls -t "$HOME"/Library/Logs/DiagnosticReports/*[Pp]icaluma* 2>/dev/null | head -1)"
  if [ -n "$CRASH" ]; then echo "$CRASH"; head -120 "$CRASH"; else echo "(none)"; fi
} >"$REPORT" 2>&1
pbcopy <"$REPORT"
echo "  Report saved to Desktop/picaluma-mac-report.txt and copied to the clipboard."
echo "  Paste it to Claude (or attach it to https://github.com/$REPO/issues) so it can be fixed."
exit 1
