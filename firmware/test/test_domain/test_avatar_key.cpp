#include <unity.h>

#include "../../src/domain/AvatarKey.h"

#include <string>

using howler::domain::iconKeyFromAvatar;

void test_avatar_key_icon_prefix_returns_suffix() {
    const char* k = iconKeyFromAvatar("icon:paw");
    TEST_ASSERT_NOT_NULL(k);
    TEST_ASSERT_EQUAL_STRING("paw", k);
}

void test_avatar_key_icon_prefix_with_long_suffix() {
    const char* k = iconKeyFromAvatar("icon:briefcase");
    TEST_ASSERT_NOT_NULL(k);
    TEST_ASSERT_EQUAL_STRING("briefcase", k);
}

void test_avatar_key_uuid_returns_verbatim() {
    // 32 lowercase hex — the canonical avatar UUID shape. The
    // IconCache passes this through to net_.fetchIcon(); the
    // WifiNetwork adapter detects the shape and routes to
    // /api/avatars/<uuid>?format=1bit instead of /api/icons/<name>.
    const std::string uuid = "deadbeefcafebabe1234567890abcdef";
    const char* k = iconKeyFromAvatar(uuid);
    TEST_ASSERT_NOT_NULL(k);
    TEST_ASSERT_EQUAL_STRING(uuid.c_str(), k);
}

void test_avatar_key_empty_returns_null() {
    TEST_ASSERT_NULL(iconKeyFromAvatar(""));
}

void test_avatar_key_too_short_returns_null() {
    // Less than the "icon:" prefix length — can't be a preset key,
    // and 4 chars can't be a UUID either.
    TEST_ASSERT_NULL(iconKeyFromAvatar("icon"));
    TEST_ASSERT_NULL(iconKeyFromAvatar("a"));
}

void test_avatar_key_icon_prefix_with_no_suffix_returns_null() {
    // "icon:" alone is malformed — caller should fall back to
    // initials. The size check (`<= 5`) catches this.
    TEST_ASSERT_NULL(iconKeyFromAvatar("icon:"));
}

void test_avatar_key_uuid_with_uppercase_hex_returns_null() {
    // The avatar UUID format is lowercase hex everywhere in the
    // schema (newUuid() emits lowercase). Uppercase shouldn't match
    // — falls through to text initials. Defensive against a future
    // bug where someone manually inserts an uppercase id.
    TEST_ASSERT_NULL(iconKeyFromAvatar("DEADBEEFCAFEBABE1234567890ABCDEF"));
}

void test_avatar_key_uuid_with_non_hex_char_returns_null() {
    // 32 chars but contains a 'g'. Not a UUID, not an icon prefix
    // — has to fall through to nullptr.
    TEST_ASSERT_NULL(iconKeyFromAvatar("deadbeefcafebabe1234567890abcdeg"));
}

void test_avatar_key_uuid_wrong_length_returns_null() {
    TEST_ASSERT_NULL(iconKeyFromAvatar("deadbeef"));               // 8
    TEST_ASSERT_NULL(iconKeyFromAvatar("deadbeefcafebabe"));        // 16
    TEST_ASSERT_NULL(iconKeyFromAvatar("deadbeefcafebabe1234567890abcdef0"));  // 33
}

void test_avatar_key_unknown_format_returns_null() {
    // Future variants like "url:..." or "data:..." aren't supported
    // — caller handles them via initials fallback.
    TEST_ASSERT_NULL(iconKeyFromAvatar("https://example.com/avatar.png"));
    TEST_ASSERT_NULL(iconKeyFromAvatar("data:image/png;base64,..."));
}
