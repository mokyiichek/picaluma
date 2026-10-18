#!/bin/bash
# Guided setup for Picaluma's macOS code signing + notarization.
# Runs on the maintainer's Mac. It never sees or stores your passwords: you type them only into
# Apple's and GitHub's own pages/dialogs. It opens each page, finds the certificate and copies
# values to the clipboard for you to paste.
set -u
REPO_SECRETS="https://github.com/mokyiichek/picaluma/settings/secrets/actions"
pause() { echo; read -r -p "  ➜ $1 — press Return when done. " _ </dev/tty; }
banner() { echo; echo "────────────────────────────────────────────────────────"; echo "  $1"; echo "────────────────────────────────────────────────────────"; }

banner "Step 1 of 5 — Team ID"
open "https://developer.apple.com/account#MembershipDetailsCard"
echo "  Sign in, find 'Team ID' (10 characters)."
pause "Copy your Team ID"

banner "Step 2 of 5 — Developer ID Application certificate"
IDENTITY=$(security find-identity -v -p codesigning | grep -o '"Developer ID Application: [^"]*"' | head -1 | tr -d '"')
if [ -n "$IDENTITY" ]; then
  echo "  Found: $IDENTITY"
else
  if [ -d "/Applications/Xcode.app" ]; then
    open -a Xcode
    echo "  In Xcode: Settings… → Accounts → your Apple ID → Manage Certificates… → + → Developer ID Application"
  else
    open "https://developer.apple.com/account/resources/certificates/add"
    echo "  No Xcode: in Keychain Access use Certificate Assistant → 'Request a Certificate From a"
    echo "  Certificate Authority' (save to disk), then on the page that just opened choose"
    echo "  'Developer ID Application', upload the request, download the .cer and double-click it."
  fi
  pause "Create the certificate"
  IDENTITY=$(security find-identity -v -p codesigning | grep -o '"Developer ID Application: [^"]*"' | head -1 | tr -d '"')
  [ -z "$IDENTITY" ] && { echo "  ✗ Still no Developer ID Application certificate in your keychain. Re-run when it's installed."; exit 1; }
  echo "  Found: $IDENTITY"
fi

banner "Step 3 of 5 — Export the certificate (.p12)"
P12="$HOME/Desktop/picaluma-developer-id.p12"
rm -f "$P12"
open -a "Keychain Access"
echo "  Keychain Access is open. Export ONLY the Developer ID certificate (not other keys):"
echo "    1. Left sidebar: 'login', top tabs: 'My Certificates'"
echo "    2. Right-click \"$IDENTITY\" → Export…"
echo "    3. Save As: picaluma-developer-id   Where: Desktop   Format: Personal Information Exchange (.p12)"
echo "    4. Choose an export password (you'll paste it into GitHub in step 5), then allow with your Mac password"
pause "Export the .p12 to your Desktop"
[ -s "$P12" ] || { echo "  ✗ $P12 not found."; exit 1; }
echo "  Saved $P12"

banner "Step 4 of 5 — App-specific password (for notarization)"
open "https://account.apple.com/account/manage/section/security"
echo "  Sign-In and Security → App-Specific Passwords → + → name it 'Picaluma' → copy it."
pause "Create the app-specific password (keep it in your clipboard or notes)"

banner "Step 5 of 5 — Add 6 secrets on GitHub"
open "$REPO_SECRETS"
echo "  Click 'New repository secret' for each. Values are copied to your clipboard one by one."
base64 -i "$P12" | tr -d '\n' | pbcopy
echo; echo "  1) APPLE_CERTIFICATE           = (copied to clipboard now — paste it)"
pause "Add APPLE_CERTIFICATE"
echo "  2) APPLE_CERTIFICATE_PASSWORD  = the export password you chose in step 3 (type it)"
pause "Add APPLE_CERTIFICATE_PASSWORD"
printf "%s" "$IDENTITY" | pbcopy
echo "  3) APPLE_SIGNING_IDENTITY      = $IDENTITY   (copied)"
pause "Add APPLE_SIGNING_IDENTITY"
printf "%s" "ycgallery@gmail.com" | pbcopy
echo "  4) APPLE_ID                    = ycgallery@gmail.com   (copied)"
pause "Add APPLE_ID"
echo "  5) APPLE_PASSWORD              = the app-specific password from step 4 (paste it)"
pause "Add APPLE_PASSWORD"
TEAM=$(echo "$IDENTITY" | sed -n 's/.*(\([A-Z0-9]\{10\}\)).*/\1/p')
printf "%s" "$TEAM" | pbcopy
echo "  6) APPLE_TEAM_ID               = $TEAM   (copied)"
pause "Add APPLE_TEAM_ID"

printf "" | pbcopy
rm -P "$P12" 2>/dev/null || rm -f "$P12"
banner "Done"
echo "  The .p12 copy on your Desktop was deleted (the certificate stays in your keychain)."
echo "  Tell Claude: \"secrets added\" — the next build will be signed and notarized by Apple."
