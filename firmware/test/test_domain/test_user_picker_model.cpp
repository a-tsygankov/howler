#include <unity.h>

#include "../../src/domain/User.h"
#include "../../src/domain/UserPickerModel.h"

using howler::domain::buildUserPickerItems;
using howler::domain::User;

namespace {

User makeUser(const char* id, const char* name, const char* avatarId,
              const char* login = "") {
    User u;
    u.id = id;
    u.displayName = name;
    u.avatarId = avatarId;
    u.login = login;
    u.updatedAt = 1700000000;
    return u;
}

}  // namespace

void test_user_picker_pins_skip_first_with_no_avatar() {
    const auto items = buildUserPickerItems({});
    TEST_ASSERT_EQUAL(1u, items.size());
    TEST_ASSERT_EQUAL_STRING("skip", items[0].id.c_str());
    TEST_ASSERT_EQUAL_STRING("skip", items[0].title.c_str());
    TEST_ASSERT_EQUAL_STRING("no attribution", items[0].subtitle.c_str());
    // No avatar on the skip row — the label "skip" speaks for itself
    // and we don't want a stray badge on what's deliberately the
    // "no user" affirmative.
    TEST_ASSERT_TRUE(items[0].iconKey.empty());
}

void test_user_picker_appends_users_after_skip_in_order() {
    const std::vector<User> users = {
        makeUser("u1", "Alice", "icon:paw", "alice"),
        makeUser("u2", "Bob",   "icon:dog"),
    };
    const auto items = buildUserPickerItems(users);
    TEST_ASSERT_EQUAL(3u, items.size());
    TEST_ASSERT_EQUAL_STRING("skip", items[0].id.c_str());
    TEST_ASSERT_EQUAL_STRING("u1",   items[1].id.c_str());
    TEST_ASSERT_EQUAL_STRING("Alice", items[1].title.c_str());
    TEST_ASSERT_EQUAL_STRING("alice", items[1].subtitle.c_str());
    TEST_ASSERT_EQUAL_STRING("u2",   items[2].id.c_str());
}

void test_user_picker_stamps_avatar_id_onto_iconKey() {
    const std::vector<User> users = {
        makeUser("u1", "Alice", "icon:paw"),
        makeUser("u2", "Bob",   "deadbeefcafebabe1234567890abcdef"),
        makeUser("u3", "Cleo",  ""),
    };
    const auto items = buildUserPickerItems(users);
    // Preset icon — passes through verbatim so the renderer can call
    // iconKeyFromAvatar() to peel the prefix.
    TEST_ASSERT_EQUAL_STRING("icon:paw", items[1].iconKey.c_str());
    // UUID photo — also passes through verbatim. The render layer
    // recognises the lack of `icon:` prefix and falls back to
    // initials, matching TaskCard's logic.
    TEST_ASSERT_EQUAL_STRING("deadbeefcafebabe1234567890abcdef",
                             items[2].iconKey.c_str());
    // Empty avatarId — the user never picked one. The render layer
    // skips the badge and renders a title-only card (matching the
    // pre-avatar Settings menu look).
    TEST_ASSERT_TRUE(items[3].iconKey.empty());
}

void test_user_picker_falls_back_to_id_when_displayName_missing() {
    const std::vector<User> users = {
        makeUser("user-12345678", "", "icon:paw"),
    };
    const auto items = buildUserPickerItems(users);
    // Not pretty but better than empty — covers a sync round that
    // beat the user-rename setting flow.
    TEST_ASSERT_EQUAL_STRING("user-12345678", items[1].title.c_str());
}

void test_user_picker_omits_subtitle_when_login_missing() {
    const std::vector<User> users = {
        makeUser("u1", "Alice", "icon:paw"),  // no login
    };
    const auto items = buildUserPickerItems(users);
    TEST_ASSERT_TRUE(items[1].subtitle.empty());
}
