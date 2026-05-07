#pragma once

#include "../application/Ports.h"

namespace howler::adapters {

/// Offline mode. main.cpp uses this whenever HOWLER_BACKEND_URL or
/// the device token is missing, so the device still boots and the
/// UI is exercisable without a backend (matches Feedme).
class NoopNetwork : public howler::application::INetwork {
public:
    using NetResult = howler::application::NetResult;

    bool isOnline() const override { return false; }

    NetResult fetchPending(std::vector<howler::domain::Occurrence>&) override {
        return NetResult::transient();
    }
    NetResult fetchDashboard(std::vector<howler::domain::DashboardItem>&, int64_t& nowSec) override {
        nowSec = 0;
        return NetResult::transient();
    }
    NetResult fetchUsers(std::vector<howler::domain::User>&) override {
        return NetResult::transient();
    }
    NetResult fetchResultTypes(std::vector<howler::domain::ResultType>&) override {
        return NetResult::transient();
    }
    NetResult postMarkDone(const howler::domain::MarkDoneDraft&) override {
        return NetResult::transient();
    }
    NetResult postHeartbeat(const std::string&) override {
        return NetResult::transient();
    }
};

}  // namespace howler::adapters
