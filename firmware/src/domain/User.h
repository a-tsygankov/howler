#pragma once

#include <cstdint>
#include <string>

namespace howler::domain {

/// One member of the home — used by the user-picker after a mark-done.
/// `avatarId` is opaque; the display layer turns it into the avatar
/// image (or initials fallback).
struct User {
    std::string id;          // 32-hex
    std::string displayName;
    std::string login;       // optional (may be empty)
    std::string avatarId;    // optional (may be empty)
    int64_t     updatedAt;   // epoch seconds — sync watermark
};

}  // namespace howler::domain
