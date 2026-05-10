#include "SyncService.h"

namespace howler::application {

namespace {

template <typename T>
int64_t maxUpdatedAt(const std::vector<T>& xs) {
    int64_t m = 0;
    for (const auto& x : xs) {
        if (x.updatedAt > m) m = x.updatedAt;
    }
    return m;
}

}  // namespace

void SyncService::tick() {
    if (!net_.isOnline()) {
        lastSyncOk_ = false;
        return;
    }
    const int64_t now = clock_.nowEpochMillis();
    if (now - lastPollMs_ < intervalMs_) return;
    lastPollMs_ = now;
    runRoundIfNeeded();
}

bool SyncService::runRoundIfNeeded() {
    const int64_t now = clock_.nowEpochMillis();
    const bool overdueFullRefresh =
        (now - lastFullRoundMs_) >= static_cast<int64_t>(fullRefreshMs_);

    // External requestSync() (e.g. Settings → Sync now, or post-
    // mark-done) bypasses peek entirely — the user wants a fresh
    // round and we shouldn't second-guess that. Same for the very
    // first tick (lastCounter_ < 0) where we have nothing to
    // compare against, and for the periodic refresh that keeps
    // server-computed urgency labels (nextDeadline / isMissed)
    // accurate even when no DB row changed.
    if (forceNextRound_ || lastCounter_ < 0 || overdueFullRefresh) {
        forceNextRound_ = false;
        runRound();
        if (lastSyncOk_) {
            lastFullRoundMs_ = now;
            // Anchor lastCounter_ so the next tick's peek has a
            // baseline. A failure here is fine — lastCounter_ stays
            // negative or whatever it was, the next tick will peek
            // again. We trade one extra round-trip for the
            // post-round freshness of the counter; without it the
            // next peek would always mismatch (cached < server)
            // and trigger a redundant full round.
            int64_t c = 0;
            if (net_.peekHomeCounter(c).isOk()) lastCounter_ = c;
        }
        return true;
    }

    // Peek path. One TLS handshake + ~200 B response — ~10x cheaper
    // on D1 reads + bandwidth than the full four-fetch round when
    // the home is idle. See docs/sync-analysis.md.
    int64_t serverCounter = 0;
    const auto peek = net_.peekHomeCounter(serverCounter);
    if (!peek.isOk()) {
        // Peek failed (transient: timeout / DNS / 5xx, or
        // permanent: 404 / malformed). Fall through to a full round
        // — we'd rather pay the bandwidth than miss real data.
        runRound();
        if (lastSyncOk_) lastFullRoundMs_ = now;
        return true;
    }
    if (serverCounter == lastCounter_) {
        // Skip — nothing has changed in the home since the last
        // round. Keep the peek-cached value, mark sync as ok so
        // networkHealth() stays Fresh, leave watermark.lastFullSync
        // untouched (it's the timestamp of the last *successful
        // full round* and the freshness of cached data hasn't
        // moved), and bail.
        lastSyncOk_ = true;
        return false;
    }

    // Counter advanced — at least one home-scoped row changed
    // since we last fetched. Run the full four-fetch round and
    // remember the new counter as the post-round baseline.
    runRound();
    if (lastSyncOk_) {
        lastCounter_     = serverCounter;
        lastFullRoundMs_ = now;
    }
    return true;
}

void SyncService::runRound() {
    bool anyOk = false;

    // 1. Dashboard — primary source for the home screen + the All
    //    tasks screen. The network call always passes
    //    ?include=hidden so we get every active task with its tier;
    //    we split client-side: the focused dashboard hides HIDDEN,
    //    the all-tasks model keeps everything.
    {
        std::vector<howler::domain::DashboardItem> items;
        int64_t serverNow = 0;
        const auto r = net_.fetchDashboard(items, serverNow);
        if (r.isOk()) {
            watermark_.dashboard = maxUpdatedAt(items);
            if (serverNow > 0) watermark_.serverNowSec = serverNow;
            std::vector<howler::domain::DashboardItem> visible;
            visible.reserve(items.size());
            for (const auto& it : items) {
                if (it.urgency != howler::domain::Urgency::Hidden) {
                    visible.push_back(it);
                }
            }
            dashboard_.replace(std::move(visible));
            allTasks_.replace(std::move(items));
            anyOk = true;
        }
    }

    // 2. Users — needed by the post-done picker.
    {
        std::vector<howler::domain::User> us;
        const auto r = net_.fetchUsers(us);
        if (r.isOk()) {
            watermark_.users = maxUpdatedAt(us);
            users_ = std::move(us);
            anyOk = true;
        }
    }

    // 3. Result types — needed by the post-done picker.
    {
        std::vector<howler::domain::ResultType> rts;
        const auto r = net_.fetchResultTypes(rts);
        if (r.isOk()) {
            watermark_.resultTypes = maxUpdatedAt(rts);
            resultTypes_ = std::move(rts);
            anyOk = true;
        }
    }

    // 4. Legacy occurrence feed — used by the original test and as
    //    a fallback if /dashboard isn't responding. The dashboard
    //    feed already contains everything renderable, so this is a
    //    secondary source today.
    {
        std::vector<howler::domain::Occurrence> next;
        const auto r = net_.fetchPending(next);
        if (r.isOk()) {
            occList_.replace(std::move(next));
            anyOk = true;
        }
    }

    // 5. Home identity (display_name + avatarId + tz). Tiny payload,
    //    rarely changes — we still refresh on every full round so a
    //    rename / avatar swap from the webapp shows up on the device
    //    within one sync cycle. Failure is non-fatal: we keep the
    //    cached identity if any (the screen falls back to deviceId
    //    tail when displayName is empty).
    {
        howler::domain::HomeIdentity next;
        const auto r = net_.fetchHomeIdentity(next);
        if (r.isOk()) {
            homeIdentity_ = std::move(next);
            anyOk = true;
        }
    }

    if (anyOk) {
        watermark_.lastFullSync = clock_.nowEpochSeconds();
    }
    lastSyncOk_ = anyOk;
}

}  // namespace howler::application
