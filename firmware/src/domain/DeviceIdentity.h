#pragma once

// This device's own identity, surfaced to the Settings → About card.
// Mirrors the wire shape of `GET /api/devices/me` (see
// backend/src/routes/devices.ts). Lives in domain/ so SyncService +
// the screen layer can reason about it without HTTP types.
//
// `name` is the user-set display name (PATCH /api/devices/:id from the
// webapp); empty when the owner hasn't named the dial, in which case
// the About card falls back to the hex device-id tail. The rename
// bumps the home update_counter, so the dial re-fetches this on its
// next full sync round and the new name appears without a reboot.

#include <string>

namespace howler::domain {

struct DeviceIdentity {
    std::string id;
    std::string name;     // optional (may be empty)
    std::string serial;
    std::string hwModel;
};

}  // namespace howler::domain
