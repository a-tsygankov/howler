#include "SyncService.h"
#include <vector>

namespace howler::application {

void SyncService::tick() {
    if (!net_.isOnline()) return;
    const int64_t now = clock_.nowEpochMillis();
    if (now - lastPollMs_ < intervalMs_) return;
    lastPollMs_ = now;

    std::vector<howler::domain::Occurrence> next;
    if (net_.fetchPending(next)) {
        list_.replace(std::move(next));
    }
}

}  // namespace howler::application
