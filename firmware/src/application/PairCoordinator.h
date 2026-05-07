#pragma once

#include "Ports.h"
#include "../domain/PairState.h"

namespace howler::application {

/// Owns the lifecycle of one pairing attempt. The Pair screen calls
/// `start()` on entry, then `tick()` from the LVGL frame loop; the
/// coordinator polls /api/pair/check every ~3 s and updates `state_`.
/// On confirmation it persists the deviceToken via IStorage and exposes
/// the new value through `state().deviceToken`.
class PairCoordinator {
public:
    PairCoordinator(IPairApi& api, IStorage& storage, IClock& clock)
        : api_(api), storage_(storage), clock_(clock) {}

    /// Begin a fresh attempt. Generates state.pairCode + expiresAt.
    /// Must be called once before `tick()` does anything useful.
    void start(const std::string& deviceId);

    /// Cancel the current attempt locally — clears the state and
    /// stops polling. Doesn't notify the server (no /pair/cancel
    /// endpoint today; the pending row will expire on the server).
    void cancel();

    /// Frame-loop poll. No-ops while the cool-down is active.
    void tick();

    const howler::domain::PairState& state() const { return state_; }

    /// Path to the persisted token, exposed for the boot flow.
    static constexpr const char* kTokenKey = "howler.token";

    /// True once a token has been written (i.e. paired). Inspected at
    /// boot to decide between the Pair screen and the Dashboard.
    static bool isPaired(IStorage& storage) {
        std::string t;
        return storage.readBlob(kTokenKey, t) && !t.empty();
    }

    /// Clear local token — "unpair" from settings. The server keeps
    /// the device row; re-pairing reuses the same deviceId.
    static void clearToken(IStorage& storage) {
        storage.eraseKey(kTokenKey);
    }

private:
    IPairApi& api_;
    IStorage& storage_;
    IClock& clock_;
    std::string deviceId_;
    howler::domain::PairState state_;
    int64_t lastPollMs_ = 0;
    static constexpr int64_t kPollIntervalMs = 3000;
};

}  // namespace howler::application
