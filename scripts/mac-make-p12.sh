#!/bin/bash
# Makes ~/Desktop/picaluma-developer-id.p12 without Keychain Access, for when its .p12 export is
# greyed out. Creates a new private key + certificate request on this Mac, you upload the request
# to Apple and download the certificate, and this packs both into the .p12 for GitHub.
# Your passwords are typed only on this Mac; nothing is sent anywhere by this script.
#
#   curl -fsSL https://raw.githubusercontent.com/mokyiichek/picaluma/main/scripts/mac-make-p12.sh | bash
set -euo pipefail
SSL=/usr/bin/openssl
OUT="$HOME/Desktop/picaluma-developer-id.p12"
WORK="$HOME/Desktop/picaluma-cert"
mkdir -p "$WORK"; chmod 700 "$WORK"; cd "$WORK"
pause() { echo; read -r -p "  ➜ $1 — press Return when done. " _ </dev/tty; }

echo "1) Creating a private key and certificate request…"
if [ ! -s dev.key ]; then
  $SSL genrsa -out dev.key 2048 2>/dev/null
  chmod 600 dev.key
fi
$SSL req -new -key dev.key -out Picaluma.certSigningRequest -subj "/CN=Picaluma Developer ID/C=MY"
echo "   Saved Desktop/picaluma-cert/Picaluma.certSigningRequest"

echo; echo "2) Get the certificate from Apple"
open "https://developer.apple.com/account/resources/certificates/add"
echo "   On the page that opened:"
echo "     • choose 'Developer ID Application' → Continue"
echo "     • Profile Type: 'G2 Sub-CA (Xcode 11.4.1 or later)'"
echo "     • Choose File → Desktop → picaluma-cert → Picaluma.certSigningRequest → Continue"
echo "     • click Download (it saves developerID_application.cer to Downloads)"
pause "Download the certificate"
CER="$(ls -t "$HOME"/Downloads/developerID_application*.cer 2>/dev/null | head -1 || true)"
[ -n "$CER" ] || { echo "✗ No developerID_application*.cer in Downloads. Re-run this script after downloading it."; exit 1; }
$SSL x509 -inform DER -in "$CER" -out cert.pem 2>/dev/null || $SSL x509 -in "$CER" -out cert.pem
if [ "$($SSL x509 -noout -modulus -in cert.pem)" != "$($SSL rsa -noout -modulus -in dev.key 2>/dev/null)" ]; then
  echo "✗ $CER wasn't made from this request. Download the certificate you just created and re-run."; exit 1
fi
IDENTITY="$($SSL x509 -noout -subject -in cert.pem | sed -n 's/.*CN=\([^/]*\).*/\1/p')"
echo "   Certificate: $IDENTITY"

echo; echo "3) Choose a password for the .p12 (you'll paste it into GitHub as APPLE_CERTIFICATE_PASSWORD)"
while :; do
  read -r -s -p "   Password: " P1 </dev/tty; echo
  read -r -s -p "   Again:    " P2 </dev/tty; echo
  [ -n "$P1" ] && [ "$P1" = "$P2" ] && break
  echo "   Passwords were empty or didn't match — try again."
done
P12PASS="$P1" $SSL pkcs12 -export -inkey dev.key -in cert.pem -name "$IDENTITY" \
  -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -passout env:P12PASS -out "$OUT"
unset P1 P2
cd "$HOME"; rm -P "$WORK"/dev.key 2>/dev/null || true; rm -rf "$WORK"

echo; echo "✓ Saved $OUT"
echo "   APPLE_SIGNING_IDENTITY = $IDENTITY"
echo "   Go back to the setup script and press Return to continue with step 4."
