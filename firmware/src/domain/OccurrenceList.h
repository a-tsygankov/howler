#pragma once

#include "Occurrence.h"
#include <algorithm>
#include <vector>

namespace howler::domain {

/// Holds the device's currently-pending occurrences and exposes them
/// in render order (most-urgent first). Pure value — testable without
/// LVGL or any Arduino headers (plan §15 HIL-1).
class OccurrenceList {
public:
    void replace(std::vector<Occurrence> next) {
        items_ = std::move(next);
        sort();
    }

    const std::vector<Occurrence>& items() const { return items_; }

    /// Most-urgent first: higher priority wins; tie-breaks on earliest dueAt
    /// (treating <0 sentinel as "lowest urgency time"). Stable per equal keys.
    static int compare(const Occurrence& a, const Occurrence& b) {
        if (a.priority != b.priority) {
            return a.priority > b.priority ? -1 : 1;
        }
        const int64_t aDue = a.dueAt < 0 ? INT64_MAX : a.dueAt;
        const int64_t bDue = b.dueAt < 0 ? INT64_MAX : b.dueAt;
        if (aDue != bDue) return aDue < bDue ? -1 : 1;
        return 0;
    }

private:
    std::vector<Occurrence> items_;

    void sort() {
        std::stable_sort(items_.begin(), items_.end(),
            [](const Occurrence& a, const Occurrence& b) { return compare(a, b) < 0; });
    }
};

}  // namespace howler::domain
