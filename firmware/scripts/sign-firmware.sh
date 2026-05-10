#!/usr/bin/env bash
#
# Sign a firmware-merged.bin with the RSA-3072 signing key.
#
# Inputs (env or args):
#   $1            — path to the binary to sign (default:
#                   firmware/.pio/build/crowpanel/firmware-merged.bin)
#   SIGNING_KEY   — path to the private key PEM (default:
#                   firmware/scripts/secrets/signing-key.pem)
#                   In CI this is materialised from the
#                   OTA_SIGNING_KEY GitHub secret into a temp file.
#
# Outputs (alongside the input bin):
#   <basename>.sha256        — 64 hex chars + newline. Same value
#                              the manifest carries; the dial
#                              recomputes after download to detect
#                              transport corruption.
#   <basename>.sig           — raw 384-byte RSA-3072 signature over
#                              SHA-256 of the binary, PKCS#1 v1.5.
#                              The dial verifies this against the
#                              embedded public key on download.
#
# Both outputs are designed to be uploaded to R2 next to the .bin
# itself. The Worker doesn't read .sig — it only carries the
# manifest's sha256 + r2Key + sizeBytes. Verification happens
# device-side (F4 / F5).

set -euo pipefail

BIN="${1:-firmware/.pio/build/crowpanel/firmware-merged.bin}"
SIGNING_KEY="${SIGNING_KEY:-firmware/scripts/secrets/signing-key.pem}"

if [[ ! -f "$BIN" ]]; then
    echo "ERROR: binary not found at $BIN" >&2
    echo "       Run \`pio run -e crowpanel\` first." >&2
    exit 1
fi
if [[ ! -f "$SIGNING_KEY" ]]; then
    echo "ERROR: signing key not found at $SIGNING_KEY" >&2
    echo "       Run firmware/scripts/generate-signing-key.sh first," >&2
    echo "       or in CI, materialise OTA_SIGNING_KEY into the file." >&2
    exit 1
fi

SHA256_OUT="${BIN}.sha256"
SIG_OUT="${BIN}.sig"

# 1. SHA-256 of the binary, hex-encoded. The trailing space-+-filename
#    that openssl/dgst emits is stripped so the file is just the hash.
openssl dgst -sha256 -binary "$BIN" | xxd -p -c 256 > "$SHA256_OUT"

# 2. Raw RSA-3072 signature over the SHA-256 digest. -sign expects
#    the message on stdin; we pass the BIN itself and let openssl
#    hash internally. PKCS#1 v1.5 padding is the openssl default;
#    matches what mbedTLS expects when verifying with the embedded
#    public key.
openssl dgst -sha256 -sign "$SIGNING_KEY" -out "$SIG_OUT" "$BIN"

SIZE_BYTES=$(stat -c%s "$BIN" 2>/dev/null || stat -f%z "$BIN")
SHA256_HEX=$(cat "$SHA256_OUT")

cat <<EOF
Signed firmware:
  bin   : $BIN  ($SIZE_BYTES bytes)
  sha256: $SHA256_HEX
  sig   : $SIG_OUT  ($(stat -c%s "$SIG_OUT" 2>/dev/null || stat -f%z "$SIG_OUT") bytes)
EOF
