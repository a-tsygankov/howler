#pragma once

// Pure aliasing-suppression rule for DrumScroller. Extracted from
// the screens/components layer so the edge cases (n = 0 / 1 / 2 /
// short lists) are unit-testable on the host without dragging
// LVGL into the native test build.
//
// The drum displays at most 7 slots — centre + 3 above + 3 below.
// With `n` items in the underlying list, every visible tier ±k
// resolves to `(cursor + k) mod n`. When n is small, modulo wrap
// makes two distinct tiers point at the same index — i.e. the
// same row appears twice on screen, mirrored above and below the
// centre. The user reads that as a broken UI ("the drum is
// echoing itself"), so we hide the offending tiers.
//
// Boundaries (proved by hand for each):
//
//   n = 0       → nothing renders.
//   n = 1       → only the centre.
//   n = 2       → centre + tier+1; tier-1 would alias to the same
//                 OTHER item as tier+1, producing a visible
//                 duplicate. We pick tier+1 (below the centre)
//                 because "scroll down to see next" matches the
//                 design handoff's drum metaphor and gives a
//                 cleaner empty-space-above look on the round
//                 disc.
//   n < 5       → tier ±2 are hidden. With n = 3 they alias ±1;
//                 with n = 4 they alias each other.
//   n < 7       → tier ±3 are hidden. Same shape as ±2 above.
//
// `maxVisibleDistance` lets a screen cap how far out the drum
// renders even on long lists (the dashboard / task-list use 1 to
// keep the round disc uncluttered; menu screens use 3).

#include <cstddef>

namespace howler::domain {

/// True iff the slot at `tier` (0 = centre, ±1 = adjacent, …)
/// should be hidden for the given item count. The DrumScroller
/// loops through tiers [-3, +3] and skips rendering whenever
/// this returns true.
inline bool drumTierAliases(size_t itemCount, int tier,
                            int maxVisibleDistance) {
    const int dist = tier < 0 ? -tier : tier;
    if (dist > maxVisibleDistance) return true;
    if (itemCount == 0) return true;
    if (itemCount == 1 && tier != 0) return true;
    // n = 2: tier-1 and tier+1 both wrap to the same OTHER index.
    // Pick tier+1 (visually "below the centre" given the design
    // handoff's drum stack); hide tier-1 to avoid the duplicate.
    if (itemCount == 2 && tier == -1) return true;
    if (itemCount < 5 && (tier == -2 || tier == 2)) return true;
    if (itemCount < 7 && (tier == -3 || tier == 3)) return true;
    return false;
}

}  // namespace howler::domain
