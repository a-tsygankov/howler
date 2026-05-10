#!/usr/bin/env bash
#
# Generate the RSA-3072 keypair used to sign firmware images.
# One-shot — run it once when bootstrapping CI; the same keypair
# stays alive for the project's lifetime (rotating it requires a
# device-side re-flash to embed the new public key).
#
# Outputs:
#   firmware/scripts/secrets/signing-key.pem      — PRIVATE, gitignored
#   firmware/scripts/secrets/signing-key.pub.pem  — PUBLIC,  committed
#
# After running, you need TWO follow-up actions:
#
#   1. Add the contents of signing-key.pem to GitHub Actions secrets
#      as `OTA_SIGNING_KEY`. The release workflow reads it to sign
#      firmware-merged.bin.
#
#   2. Run firmware/scripts/embed-pubkey.py to bake the .pub.pem
#      bytes into firmware/src/application/SigningPublicKey.h. The
#      firmware verifies signatures against this embedded key on
#      OTA download (F4).
#
# Why RSA-3072 (not 2048 / 4096): plan §14 spec — same scheme as
# ESP-IDF Secure Boot v2 so we can later swap to bootloader-level
# verification without re-issuing keys.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SECRETS_DIR="$SCRIPT_DIR/secrets"
PRIVATE_KEY="$SECRETS_DIR/signing-key.pem"
PUBLIC_KEY="$SECRETS_DIR/signing-key.pub.pem"

mkdir -p "$SECRETS_DIR"

if [[ -f "$PRIVATE_KEY" ]]; then
    echo "ERROR: $PRIVATE_KEY already exists. Refusing to overwrite." >&2
    echo "       Delete it manually if you really want to rotate keys" >&2
    echo "       (every device needs to be re-flashed with the new public key)." >&2
    exit 1
fi

echo "Generating RSA-3072 private key → $PRIVATE_KEY"
openssl genpkey \
    -algorithm RSA \
    -pkeyopt rsa_keygen_bits:3072 \
    -out "$PRIVATE_KEY"

echo "Extracting public key → $PUBLIC_KEY"
openssl rsa -in "$PRIVATE_KEY" -pubout -out "$PUBLIC_KEY"

# Lock down the private key file permissions — defensive, not a
# substitute for keeping it out of version control.
chmod 600 "$PRIVATE_KEY" 2>/dev/null || true

echo
echo "Done. Next steps:"
echo
echo "  1. Copy the private key to GitHub Actions secrets as OTA_SIGNING_KEY:"
echo "       cat $PRIVATE_KEY | gh secret set OTA_SIGNING_KEY"
echo
echo "  2. Embed the public key into the firmware build:"
echo "       python firmware/scripts/embed-pubkey.py"
echo
echo "  3. Commit signing-key.pub.pem (PUBLIC ONLY — verify .gitignore"
echo "     keeps signing-key.pem out)."
