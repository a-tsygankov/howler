#include <unity.h>

#include "../../src/domain/Version.h"

using howler::domain::compareVersions;

namespace {
int sgn(int v) { return (v > 0) - (v < 0); }
}  // namespace

void test_version_equal() {
    TEST_ASSERT_EQUAL(0, compareVersions("1.0.0", "1.0.0"));
    TEST_ASSERT_EQUAL(0, compareVersions("0.3.0", "0.3.0"));
}

void test_version_numeric_ordering_beats_lexicographic() {
    // String compare would put "1.10.0" < "1.2.0" lexicographically;
    // semver-style compare gets it right.
    TEST_ASSERT_EQUAL(1, sgn(compareVersions("1.10.0", "1.2.0")));
    TEST_ASSERT_EQUAL(-1, sgn(compareVersions("0.9.0", "0.10.0")));
}

void test_version_minor_and_patch_ordering() {
    TEST_ASSERT_EQUAL(1, sgn(compareVersions("1.4.2", "1.4.1")));
    TEST_ASSERT_EQUAL(-1, sgn(compareVersions("1.3.9", "1.4.0")));
}

void test_version_missing_segments_treated_as_zero() {
    TEST_ASSERT_EQUAL(0, compareVersions("1.4", "1.4.0"));
    TEST_ASSERT_EQUAL(-1, sgn(compareVersions("1.4", "1.4.1")));
}

void test_version_prerelease_sorts_before_release() {
    // "1.4.2-rc1" < "1.4.2" because the bare numeric form is
    // considered newer (matches node semver semantics).
    TEST_ASSERT_EQUAL(-1, sgn(compareVersions("1.4.2-rc1", "1.4.2")));
    TEST_ASSERT_EQUAL(1, sgn(compareVersions("1.4.2", "1.4.2-rc1")));
}
