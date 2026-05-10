#!/usr/bin/env bash
#
# Register a signed firmware build with the Worker. Lands the row
# as `active = 0` — promotion (`PATCH /api/firmware/:version
# {"active":true}`) is a separate manual step so a half-uploaded
# / mis-built bin can't accidentally ship to devices.
#
# Inputs (env):
#   VERSION       — semver string ("0.4.0", "0.4.0-rc1")
#   BIN           — path to firmware-merged.bin
#   SHA256_FILE   — path to <bin>.sha256 (from sign-firmware.sh)
#   R2_KEY        — object key in the howler-firmware bucket
#                   (e.g. "firmware/firmware-0.4.0.bin")
#   ADMIN_TOKEN   — UserToken from an admin user (POST /api/firmware
#                   requires requireAdmin())
#   API_URL       — base Worker URL (default: prod)
#
# Used by the firmware-release.yml workflow + can be invoked
# manually from a workstation when CI's down.

set -euo pipefail

: "${VERSION:?VERSION is required (e.g. VERSION=0.4.0)}"
: "${BIN:?BIN is required}"
: "${SHA256_FILE:?SHA256_FILE is required}"
: "${R2_KEY:?R2_KEY is required}"
: "${ADMIN_TOKEN:?ADMIN_TOKEN is required}"

API_URL="${API_URL:-https://howler-api.atsyg-feedme.workers.dev}"

if [[ ! -f "$BIN" ]]; then
    echo "ERROR: binary not found at $BIN" >&2; exit 1
fi
if [[ ! -f "$SHA256_FILE" ]]; then
    echo "ERROR: sha256 file not found at $SHA256_FILE" >&2; exit 1
fi

SHA256_HEX=$(tr -d '[:space:]' < "$SHA256_FILE")
SIZE_BYTES=$(stat -c%s "$BIN" 2>/dev/null || stat -f%z "$BIN")

# Compose the request body. Single quotes around the heredoc keep
# shell variable expansion off; we substitute via printf so the
# values get embedded as-is (no JSON escaping needed for our
# purely-numeric/hex inputs).
BODY=$(printf '{"version":"%s","sha256":"%s","r2Key":"%s","sizeBytes":%d}' \
    "$VERSION" "$SHA256_HEX" "$R2_KEY" "$SIZE_BYTES")

RESPONSE_FILE=$(mktemp)
HTTP_STATUS=$(curl -sS -o "$RESPONSE_FILE" -w "%{http_code}" \
    -X POST "$API_URL/api/firmware" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$BODY")

if [[ "$HTTP_STATUS" != "201" ]]; then
    echo "ERROR: registration failed (HTTP $HTTP_STATUS)" >&2
    cat "$RESPONSE_FILE" >&2
    rm -f "$RESPONSE_FILE"
    exit 1
fi

cat "$RESPONSE_FILE"
echo
rm -f "$RESPONSE_FILE"

echo
echo "Registered $VERSION (active=0). To promote:"
echo "  curl -X PATCH \\"
echo "    -H \"Authorization: Bearer \$ADMIN_TOKEN\" \\"
echo "    -H \"Content-Type: application/json\" \\"
echo "    -d '{\"active\":true}' \\"
echo "    $API_URL/api/firmware/$VERSION"
