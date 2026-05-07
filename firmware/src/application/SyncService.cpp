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
    runRound();
}

void SyncService::runRound() {
    bool anyOk = false;

    // 1. Dashboard — primary source for the home screen.
    {
        std::vector<howler::domain::DashboardItem> items;
        int64_t serverNow = 0;
        const auto r = net_.fetchDashboard(items, serverNow);
        if (r.isOk()) {
            watermark_.dashboard = maxUpdatedAt(items);
            dashboard_.replace(std::move(items));
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

    if (anyOk) {
        watermark_.lastFullSync = clock_.nowEpochSeconds();
    }
    lastSyncOk_ = anyOk;
}

}  // namespace howler::application
