#include <unity.h>
#include <initializer_list>

#include "../../src/domain/DrumLayout.h"

// Pure aliasing-suppression rule for the DrumScroller carousel.
// Reported bug: with n=2 items the user saw the second task
// appear BOTH above and below the cursor card — both tier-1 and
// tier+1 wrapped to the same other index. drumTierAliases()
// owns the suppression boundaries; these tests pin the answer
// for every interesting n.

using howler::domain::drumTierAliases;

// Helper for readability — alias = "should hide".
static bool shows(size_t n, int tier, int maxDist = 3) {
    return !drumTierAliases(n, tier, maxDist);
}

void test_drum_layout_n0_renders_nothing() {
    // Empty list: every slot suppressed. The screen layer paints
    // an "all clear" placeholder before the drum even builds; the
    // suppression here is belt-and-braces.
    for (int t = -3; t <= 3; ++t) {
        TEST_ASSERT_FALSE(shows(0, t));
    }
}

void test_drum_layout_n1_only_centre() {
    // Single item: only tier 0 renders. Tier ±k for any k would
    // alias back to that single item.
    TEST_ASSERT_TRUE(shows(1, 0));
    for (int t = -3; t <= 3; ++t) {
        if (t == 0) continue;
        TEST_ASSERT_FALSE(shows(1, t));
    }
}

void test_drum_layout_n2_centre_and_one_neighbour() {
    // The reported bug. With n=2, tier-1 and tier+1 BOTH wrap
    // to the same OTHER index → visible duplicate. Suppression
    // keeps tier+1 (below) and hides tier-1 (above). All other
    // tiers stay suppressed.
    TEST_ASSERT_TRUE(shows(2, 0));
    TEST_ASSERT_TRUE(shows(2, 1));
    TEST_ASSERT_FALSE(shows(2, -1));
    for (int t : {-3, -2, 2, 3}) {
        TEST_ASSERT_FALSE(shows(2, t));
    }
}

void test_drum_layout_n3_centre_plus_two_neighbours() {
    // From n=3 onward tier ±1 are distinct rows. Tier ±2 still
    // alias ∓1 (n=3 makes tier+2 wrap to (cursor+2) mod 3 ==
    // (cursor-1) mod 3) so they stay suppressed until n ≥ 5.
    for (int t : {-1, 0, 1}) {
        TEST_ASSERT_TRUE(shows(3, t));
    }
    for (int t : {-3, -2, 2, 3}) {
        TEST_ASSERT_FALSE(shows(3, t));
    }
}

void test_drum_layout_n4_still_suppresses_far_neighbours() {
    // n=4 makes tier+2 alias tier-2 (both wrap to the same
    // diametrically-opposite item). ±2 hidden until n ≥ 5.
    for (int t : {-1, 0, 1}) {
        TEST_ASSERT_TRUE(shows(4, t));
    }
    for (int t : {-3, -2, 2, 3}) {
        TEST_ASSERT_FALSE(shows(4, t));
    }
}

void test_drum_layout_n5_unlocks_tier_pm2() {
    // First n where ±2 are clean of aliasing: tier+2 = cursor+2,
    // tier-2 = cursor-2 = cursor+3, distinct from ±1 and centre.
    for (int t : {-2, -1, 0, 1, 2}) {
        TEST_ASSERT_TRUE(shows(5, t));
    }
    for (int t : {-3, 3}) {
        TEST_ASSERT_FALSE(shows(5, t));
    }
}

void test_drum_layout_n7_unlocks_all_seven_tiers() {
    // n=7 is the smallest count where ±3 are clean. At n=6,
    // tier+3 = cursor+3 = cursor-3 wraps to the same row; n=7
    // is the smallest count where ±3 don't collide.
    for (int t = -3; t <= 3; ++t) {
        TEST_ASSERT_TRUE(shows(7, t));
    }
}

void test_drum_layout_respects_maxVisibleDistance_cap() {
    // Dashboard / TaskList set maxVisibleDistance=1 so the round
    // disc isn't crowded. Even with a long list, ±2 / ±3 stay
    // suppressed.
    for (int t = -3; t <= 3; ++t) {
        const bool expected = (t >= -1 && t <= 1);
        TEST_ASSERT_EQUAL_INT(expected ? 1 : 0,
                              shows(20, t, /*maxDist=*/1) ? 1 : 0);
    }
}
