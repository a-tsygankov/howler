#pragma once

// Firmware version stamp, surfaced in:
//   • Settings → About                  (user-visible)
//   • POST /api/devices/heartbeat       (server log + future OTA)
//
// Bump when shipping a release. Format: "MAJOR.MINOR.PATCH" — no
// pre-release suffixes for now; OTA's Phase 6 design (plan §14)
// expects a strict semver-ish lex sort to decide "newer than".

namespace howler::application {

constexpr const char* kFirmwareVersion = "0.3.0";

}  // namespace howler::application
