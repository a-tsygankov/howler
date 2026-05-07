#include "PairCoordinator.h"

namespace howler::application {

void PairCoordinator::start(const std::string& deviceId) {
    deviceId_ = deviceId;
    state_ = {};
    state_.phase = howler::domain::PairPhase::Started;
    state_.lastPolledAt = clock_.nowEpochSeconds();
    const auto r = api_.start(deviceId_, state_);
    if (!r.isOk()) {
        state_.phase = howler::domain::PairPhase::Failed;
        state_.lastError = "pair-start failed";
    }
    lastPollMs_ = clock_.nowEpochMillis();
}

void PairCoordinator::cancel() {
    state_ = {};
    state_.phase = howler::domain::PairPhase::Idle;
    deviceId_.clear();
}

void PairCoordinator::tick() {
    using howler::domain::PairPhase;
    const int64_t nowMs = clock_.nowEpochMillis();

    // Failed → retry start() on the cool-down so a device that
    // booted before Wi-Fi finished associating eventually recovers
    // without user intervention. Idle isn't reachable post-start
    // (cancel() puts us there manually), so we don't auto-start
    // from Idle here — only from Failed.
    if (state_.phase == PairPhase::Failed) {
        if (nowMs - lastPollMs_ < kPollIntervalMs) return;
        lastPollMs_ = nowMs;
        if (deviceId_.empty()) return;
        state_.lastError.clear();
        const auto r = api_.start(deviceId_, state_);
        if (!r.isOk()) {
            state_.phase = PairPhase::Failed;
            state_.lastError = "pair-start failed";
        }
        return;
    }

    if (state_.phase != PairPhase::Started && state_.phase != PairPhase::Pending) {
        return;
    }
    if (nowMs - lastPollMs_ < kPollIntervalMs) return;
    lastPollMs_ = nowMs;

    state_.lastPolledAt = clock_.nowEpochSeconds();
    const auto r = api_.check(deviceId_, state_);
    if (!r.isOk()) {
        state_.phase = PairPhase::Failed;
        state_.lastError = "pair-check failed";
        return;
    }
    if (state_.phase == PairPhase::Confirmed && !state_.deviceToken.empty()) {
        storage_.writeBlob(kTokenKey, state_.deviceToken);
    }
}

}  // namespace howler::application
