#pragma once

// Phase 6 OTA — slice F4. The advisory the server returns from
// `GET /api/firmware/check?fwVersion=…` translated into a domain
// type the device side reasons about. Pure value type so it round-
// trips through tests without dragging in HTTPClient or LVGL.
//
// The wire shape (see backend/src/routes/firmware.ts) is:
//   { updateAvailable: false }
// or
//   { updateAvailable: true,
//     version, sha256, sizeBytes,
//     r2Key, downloadUrl, downloadUrlExpiresInSec }
//
// `downloadUrl` is the V4-presigned R2 GET URL the dial follows
// directly (no Cloudflare auth at the R2 edge). `downloadUrlExpires
// InSec` is informational — the dial doesn't have to enforce it
// because R2 will refuse expired signatures on its own.

#include <cstdint>
#include <string>

namespace howler::domain {

struct UpdateAdvisory {
    bool        updateAvailable = false;

    // Populated only when `updateAvailable` is true.
    std::string version;
    /// 64-hex sha256 of the firmware image. The dial verifies the
    /// downloaded bytes against this hash before swapping the boot
    /// partition.
    std::string sha256;
    int64_t     sizeBytes = 0;
    /// 5-min pre-signed R2 GET URL. May be empty when the backend
    /// is missing R2 credentials (staging without secrets) — the
    /// dial treats that as "not flashable yet" and surfaces the
    /// version label only.
    std::string downloadUrl;
    /// TTL the URL was signed for. Informational; R2 enforces.
    int32_t     downloadUrlExpiresInSec = 0;
};

}  // namespace howler::domain
