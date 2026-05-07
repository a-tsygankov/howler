#pragma once

#include "MarkDoneDraft.h"
#include <algorithm>
#include <cstddef>
#include <vector>

namespace howler::domain {

/// FIFO outbound queue for mark-done attempts. Survives reboots when
/// snapshotted to NVS by the storage adapter — the queue itself is
/// pure (no I/O), so it's host-testable.
///
/// Idempotency lives on the server (PRIMARY KEY collision). The queue
/// just needs to keep dispatching pending drafts in insertion order
/// until each one returns success or a permanent error.
class MarkDoneQueue {
public:
    /// Cap the queue at 32 entries — at >1 ack/sec for ~30 s the
    /// device is offline-overloaded; older entries get dropped to
    /// keep memory bounded. Newer drafts are kept (they're the ones
    /// the user just pressed for).
    static constexpr size_t kMaxSize = 32;

    void enqueue(MarkDoneDraft d) {
        if (drafts_.size() >= kMaxSize) drafts_.erase(drafts_.begin());
        drafts_.push_back(std::move(d));
    }

    bool empty() const { return drafts_.empty(); }
    size_t size() const { return drafts_.size(); }

    const MarkDoneDraft* front() const {
        return drafts_.empty() ? nullptr : &drafts_.front();
    }

    MarkDoneDraft* frontMut() {
        return drafts_.empty() ? nullptr : &drafts_.front();
    }

    /// Discard the head — call after a successful send (or a 4xx
    /// server-side rejection that won't recover on retry).
    void popFront() {
        if (!drafts_.empty()) drafts_.erase(drafts_.begin());
    }

    /// For NVS persistence: the storage adapter wraps this to snapshot
    /// after every enqueue/popFront.
    const std::vector<MarkDoneDraft>& items() const { return drafts_; }
    void replaceAll(std::vector<MarkDoneDraft> next) { drafts_ = std::move(next); }

    /// Drop any entry referring to the same executionId — used when
    /// a sync response confirms the server already saw it (de-dupes
    /// after a partial-failure retry).
    void dropByExecutionId(const std::string& executionId) {
        drafts_.erase(
            std::remove_if(drafts_.begin(), drafts_.end(),
                [&](const MarkDoneDraft& d) { return d.executionId == executionId; }),
            drafts_.end());
    }

private:
    std::vector<MarkDoneDraft> drafts_;
};

}  // namespace howler::domain
