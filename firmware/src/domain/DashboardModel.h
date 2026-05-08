#pragma once

#include "DashboardItem.h"
#include <algorithm>
#include <cstddef>
#include <vector>

namespace howler::domain {

/// What the dashboard screen renders. Holds the merged list and
/// keeps a stable cursor across replace() calls so that a sync that
/// shuffles ordering doesn't yank the user's selection out from under
/// them — if the previously-selected item is still present, we restore
/// the cursor to its new index.
class DashboardModel {
public:
    void replace(std::vector<DashboardItem> next) {
        const std::string sticky = selectedId();
        items_ = std::move(next);
        sort();
        if (!sticky.empty()) {
            for (size_t i = 0; i < items_.size(); ++i) {
                if (items_[i].id == sticky) { cursor_ = i; return; }
            }
        }
        if (cursor_ >= items_.size()) cursor_ = items_.empty() ? 0 : items_.size() - 1;
    }

    const std::vector<DashboardItem>& items() const { return items_; }
    size_t cursor() const { return cursor_; }
    bool empty() const { return items_.empty(); }
    size_t size() const { return items_.size(); }

    /// Return the index of the first non-urgent item, or items_.size()
    /// if there are none. Useful for the screen separator.
    size_t firstNonUrgent() const {
        for (size_t i = 0; i < items_.size(); ++i) {
            if (items_[i].urgency == Urgency::NonUrgent) return i;
        }
        return items_.size();
    }

    size_t urgentCount() const { return firstNonUrgent(); }

    const DashboardItem* selected() const {
        if (items_.empty()) return nullptr;
        return &items_[cursor_];
    }

    /// Move the cursor by `delta` (rotary deltas) with wrap-around.
    void moveCursor(int delta) {
        if (items_.empty()) { cursor_ = 0; return; }
        const long n = static_cast<long>(items_.size());
        long c = static_cast<long>(cursor_) + delta;
        c = ((c % n) + n) % n;
        cursor_ = static_cast<size_t>(c);
    }

    void setCursorToFirstUrgent() {
        cursor_ = 0;
    }

    /// Drop the cursor on a specific index, modulo size. Used by the
    /// drum-scrolling screens to mirror the drum's resulting cursor
    /// back into the model after an inertial swipe — the drum already
    /// did the wrap arithmetic; we just align the model to match.
    void setCursor(size_t i) {
        cursor_ = items_.empty() ? 0 : (i % items_.size());
    }

    /// Drop a single item (e.g., one we just acknowledged) so the
    /// screen reflects the change before the next sync arrives.
    void removeById(const std::string& id) {
        const auto it = std::find_if(items_.begin(), items_.end(),
            [&](const DashboardItem& d) { return d.id == id; });
        if (it == items_.end()) return;
        const size_t idx = static_cast<size_t>(it - items_.begin());
        items_.erase(it);
        if (cursor_ >= items_.size()) cursor_ = items_.empty() ? 0 : items_.size() - 1;
        else if (cursor_ > idx) --cursor_;
    }

private:
    std::vector<DashboardItem> items_;
    size_t cursor_ = 0;

    std::string selectedId() const {
        return items_.empty() ? std::string{} : items_[cursor_].id;
    }

    /// Urgent-first, then by dueAt (negative means "no time" → last
    /// within tier), then by priority desc as a tiebreaker.
    void sort() {
        std::stable_sort(items_.begin(), items_.end(),
            [](const DashboardItem& a, const DashboardItem& b) {
                if (a.urgency != b.urgency) {
                    return a.urgency == Urgency::Urgent;
                }
                const int64_t aDue = a.dueAt < 0 ? INT64_MAX : a.dueAt;
                const int64_t bDue = b.dueAt < 0 ? INT64_MAX : b.dueAt;
                if (aDue != bDue) return aDue < bDue;
                return a.priority > b.priority;
            });
    }
};

}  // namespace howler::domain
