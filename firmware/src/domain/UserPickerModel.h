#pragma once

// Pure helper: build the UserPicker's RoundMenuItem list from the
// synced user vector. Pulled out of the screens layer so it's
// host-testable — the UserPicker UI used to bake the construction
// inline in screen_pickers.cpp, which mixed pure data shaping with
// LVGL widget creation. Splitting them lets native tests verify the
// "skip pinned first, users follow with avatar id stamped onto
// iconKey" contract without dragging LVGL into the test build.
//
// The returned items are owned by the caller — typically loaded into
// `RoundMenuModel::replace()` and rendered by RoundMenu, which reads
// `iconKey` to drive avatar lookup against the IconCache.

#include "RoundMenuModel.h"
#include "User.h"

#include <string>
#include <vector>

namespace howler::domain {

inline std::vector<RoundMenuItem> buildUserPickerItems(
    const std::vector<User>& users) {
    std::vector<RoundMenuItem> items;
    items.reserve(1 + users.size());

    // "skip" pinned first so the most-common action (record without
    // attribution) is one tap from entry. Empty iconKey ⇒ no avatar
    // badge — the label "skip" speaks for itself.
    {
        RoundMenuItem skip;
        skip.id = "skip";
        skip.title = "skip";
        skip.subtitle = "no attribution";
        items.push_back(std::move(skip));
    }

    for (const auto& u : users) {
        RoundMenuItem it;
        it.id = u.id;
        it.title = u.displayName.empty() ? u.id : u.displayName;
        if (!u.login.empty()) it.subtitle = u.login;
        // Pass the avatarId verbatim (matches DashboardItem.avatarId —
        // `"icon:foo"` for presets, 32-hex UUID for uploaded photos,
        // empty when the user never picked one). The render layer
        // calls iconKeyFromAvatar() to peel the prefix and ask the
        // IconCache for the bitmap; UUIDs gracefully fall back to
        // initials, matching the TaskCard rendering logic.
        it.iconKey = u.avatarId;
        items.push_back(std::move(it));
    }

    return items;
}

}  // namespace howler::domain
