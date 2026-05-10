#pragma once

// Pure helper that maps a DashboardItem.avatarId / User.avatarId
// (etc.) onto a string key the IconCache understands. Pulled out
// of TaskCard.h into the domain layer so the native test build
// can reach it — TaskCard itself drags LVGL + Arduino headers
// that don't compile on host.
//
// The unified avatarId vocabulary across the system has two shapes:
//
//   "icon:<name>" — preset glyph from webapp/src/components/Icon.tsx,
//                   rendered as a 24×24 1-bit bitmap from the icons
//                   table. Returns the suffix; the IconCache fetches
//                   /api/icons/<name>.
//
//   <32-hex-id>   — avatar uploaded by a user. Phase 7 (PR #46)
//                   added a 1-bit dithered variant alongside the
//                   WebP photo; the IconCache fetches it via
//                   /api/avatars/<uuid>?format=1bit and renders
//                   identically to a preset glyph.
//
//   anything else — caller falls back to text initials. Empty,
//                   malformed, or "icon:" with no suffix.

#include <cstdio>
#include <string>

namespace howler::domain {

/// Returns the lookup key for the IconCache, or nullptr when the
/// avatarId can't be mapped to a 1-bit bitmap. The returned pointer
/// is to a function-local static buffer; callers must copy the
/// string before the next call if they want to retain it (matches
/// the previous TaskCard.h behaviour).
inline const char* iconKeyFromAvatar(const std::string& avatarId) {
    constexpr const char* kPrefix = "icon:";
    if (avatarId.size() <= 5) {
        return nullptr;
    }
    // icon:<name> — pull the suffix.
    if (avatarId.compare(0, 5, kPrefix) == 0) {
        static char name[32];
        const auto rest = avatarId.substr(5);
        snprintf(name, sizeof(name), "%s", rest.c_str());
        return name;
    }
    // 32-hex UUID — return verbatim. The IconCache passes this
    // through to net_.fetchIcon(); WifiNetwork detects the shape
    // and routes to /api/avatars/<uuid>?format=1bit.
    if (avatarId.size() == 32) {
        bool allHex = true;
        for (char c : avatarId) {
            const bool ok =
                (c >= '0' && c <= '9') ||
                (c >= 'a' && c <= 'f');
            if (!ok) {
                allHex = false;
                break;
            }
        }
        if (allHex) {
            static char id[33];
            snprintf(id, sizeof(id), "%s", avatarId.c_str());
            return id;
        }
    }
    return nullptr;
}

}  // namespace howler::domain
