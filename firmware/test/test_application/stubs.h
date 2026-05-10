#pragma once

// Lightweight in-memory stubs for the application ports. Used by the
// host-side application-layer tests so they don't pull in any
// adapters (which depend on Arduino headers).

#include "../../src/application/Ports.h"

#include <map>
#include <queue>
#include <string>
#include <vector>

namespace howler::testing {

class StubClock : public application::IClock {
public:
    int64_t nowEpochMillis() const override { return ms_; }
    int64_t nowEpochSeconds() const override { return ms_ / 1000; }
    void advance(int64_t deltaMs) { ms_ += deltaMs; }
    void setMs(int64_t v) { ms_ = v; }

private:
    int64_t ms_ = 0;
};

class StubRandom : public application::IRandom {
public:
    std::string newUuidHex() override {
        char buf[33];
        snprintf(buf, sizeof(buf), "%032lld", static_cast<long long>(seq_++));
        return std::string(buf, 32);
    }
private:
    long long seq_ = 1;
};

class StubStorage : public application::IStorage {
public:
    bool readBlob(const std::string& key, std::string& outBytes) override {
        const auto it = data_.find(key);
        if (it == data_.end()) return false;
        outBytes = it->second;
        return true;
    }
    bool writeBlob(const std::string& key, const std::string& bytes) override {
        data_[key] = bytes;
        ++writes_;
        return true;
    }
    bool eraseKey(const std::string& key) override {
        return data_.erase(key) > 0;
    }
    size_t writes() const { return writes_; }
private:
    std::map<std::string, std::string> data_;
    size_t writes_ = 0;
};

class StubNetwork : public application::INetwork {
public:
    using NetResult = application::NetResult;

    bool isOnline() const override { return online_; }
    void setOnline(bool v) { online_ = v; }

    NetResult fetchPending(std::vector<domain::Occurrence>& out) override {
        if (!pendingResults_.empty()) {
            const auto r = pendingResults_.front();
            pendingResults_.erase(pendingResults_.begin());
            if (r.isOk()) out = nextPending_;
            return r;
        }
        return NetResult::transient();
    }

    NetResult fetchDashboard(std::vector<domain::DashboardItem>& out, int64_t& nowSec) override {
        nowSec = 1000;
        if (!dashboardResults_.empty()) {
            const auto r = dashboardResults_.front();
            dashboardResults_.erase(dashboardResults_.begin());
            if (r.isOk()) out = nextDashboard_;
            return r;
        }
        return NetResult::transient();
    }

    NetResult fetchUsers(std::vector<domain::User>& out) override {
        if (!userResults_.empty()) {
            const auto r = userResults_.front();
            userResults_.erase(userResults_.begin());
            if (r.isOk()) out = nextUsers_;
            return r;
        }
        return NetResult::transient();
    }

    NetResult fetchResultTypes(std::vector<domain::ResultType>& out) override {
        if (!resultTypeResults_.empty()) {
            const auto r = resultTypeResults_.front();
            resultTypeResults_.erase(resultTypeResults_.begin());
            if (r.isOk()) out = nextResultTypes_;
            return r;
        }
        return NetResult::transient();
    }

    NetResult postMarkDone(const domain::MarkDoneDraft& d) override {
        sentDrafts_.push_back(d);
        if (!markDoneResults_.empty()) {
            const auto r = markDoneResults_.front();
            markDoneResults_.erase(markDoneResults_.begin());
            return r;
        }
        return NetResult::ok();
    }

    NetResult postHeartbeat(const std::string&) override { return NetResult::ok(); }

    NetResult checkFirmwareUpdate(
        const std::string& currentVersion,
        domain::UpdateAdvisory& outAdvisory) override {
        ++firmwareCheckCalls_;
        lastCheckedVersion_ = currentVersion;
        if (!firmwareCheckResults_.empty()) {
            const auto r = firmwareCheckResults_.front();
            firmwareCheckResults_.erase(firmwareCheckResults_.begin());
            if (r.isOk()) outAdvisory = nextAdvisory_;
            return r;
        }
        outAdvisory = nextAdvisory_;
        return NetResult::ok();
    }

    NetResult peekHomeCounter(int64_t& outCounter) override {
        ++peekCalls_;
        if (!peekResults_.empty()) {
            const auto r = peekResults_.front();
            peekResults_.erase(peekResults_.begin());
            if (r.isOk()) outCounter = nextCounter_;
            return r;
        }
        // Default: succeed with the configured counter so tests that
        // don't care about peek failures get the cheap-path coverage
        // by default.
        outCounter = nextCounter_;
        return NetResult::ok();
    }

    // Test fixtures.
    bool online_ = true;
    std::vector<domain::DashboardItem> nextDashboard_;
    std::vector<domain::User> nextUsers_;
    std::vector<domain::ResultType> nextResultTypes_;
    std::vector<domain::Occurrence> nextPending_;
    std::vector<NetResult> dashboardResults_;
    std::vector<NetResult> userResults_;
    std::vector<NetResult> resultTypeResults_;
    std::vector<NetResult> pendingResults_;
    std::vector<NetResult> markDoneResults_;
    std::vector<domain::MarkDoneDraft> sentDrafts_;
    // Peek state: tests stage `peekResults_` (one entry per expected
    // call, drained FIFO) and update `nextCounter_` to drive
    // SyncService into the skip vs. full-sync paths.
    int64_t              nextCounter_ = 0;
    std::vector<NetResult> peekResults_;
    int                  peekCalls_ = 0;
    // checkFirmwareUpdate state — tests stage `firmwareCheckResults_`
    // (one entry per expected call, drained FIFO) and seed
    // `nextAdvisory_` for the body. Mirrors the peek pattern above.
    domain::UpdateAdvisory nextAdvisory_;
    std::vector<NetResult> firmwareCheckResults_;
    int                    firmwareCheckCalls_ = 0;
    std::string            lastCheckedVersion_;
};

class StubOtaPort : public application::IOtaPort {
public:
    Result downloadAndFlash(
        const domain::UpdateAdvisory& advisory,
        const ProgressFn& onProgress) override {
        ++downloadCalls_;
        lastAdvisory_ = advisory;
        if (onProgress && progressBytes_ > 0) {
            // Simulate one progress callback at ~50 % so the screen
            // layer's pct-rendering path gets exercised.
            onProgress(progressBytes_ / 2, progressBytes_);
            onProgress(progressBytes_, progressBytes_);
        }
        return nextResult_;
    }
    void reboot() override { ++rebootCalls_; }
    bool isPendingVerify() const override { return pendingVerify_; }
    void markValid() override { ++markValidCalls_; pendingVerify_ = false; }

    Result   nextResult_ = Result::Ok;
    int      downloadCalls_ = 0;
    int      rebootCalls_ = 0;
    int      markValidCalls_ = 0;
    bool     pendingVerify_ = false;
    int64_t  progressBytes_ = 0;
    domain::UpdateAdvisory lastAdvisory_;
};

class StubPairApi : public application::IPairApi {
public:
    using NetResult = application::NetResult;

    NetResult start(const std::string&, domain::PairState& state) override {
        state.pairCode = startCode_;
        state.expiresAt = startExpires_;
        state.phase = startPhase_;
        return startResult_;
    }
    NetResult check(const std::string&, domain::PairState& state) override {
        state.phase = checkPhase_;
        if (checkPhase_ == domain::PairPhase::Confirmed) {
            state.deviceToken = checkToken_;
        }
        return checkResult_;
    }

    std::string startCode_ = "012345";
    int64_t startExpires_ = 9999;
    domain::PairPhase startPhase_ = domain::PairPhase::Started;
    NetResult startResult_ = NetResult::ok();

    domain::PairPhase checkPhase_ = domain::PairPhase::Pending;
    std::string checkToken_ = "stub-token";
    NetResult checkResult_ = NetResult::ok();
};

}  // namespace howler::testing
