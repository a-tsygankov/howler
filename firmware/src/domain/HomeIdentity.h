#pragma once

// Home identity surfaced to the device. Mirrors the wire shape of
// `GET /api/homes/me` (see backend/src/routes/homes.ts). Lives in
// domain/ so SyncService + the screen layer can reason about it
// without dragging in HTTP types.
//
// `avatarId` follows the same convention as DashboardItem.avatarId:
// `"icon:<name>"` for a preset glyph, 32-hex UUID for an uploaded
// photo, empty when the home owner hasn't picked one. The Settings
// → About screen feeds this through the IconCache lookup, with
// initials fallback for UUID avatars (the device can't render
// arbitrary photos at 24×24 1-bit; webapp + dial intentionally
// diverge on this surface).

#include <string>

namespace howler::domain {

struct HomeIdentity {
    std::string id;
    std::string displayName;
    std::string avatarId;   // optional (may be empty)
    std::string tz;
};

}  // namespace howler::domain
