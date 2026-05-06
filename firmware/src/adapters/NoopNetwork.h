#pragma once

#include "../application/Ports.h"

namespace howler::adapters {

/// Offline mode. main.cpp uses this whenever HOWLER_BACKEND_URL or
/// Wi-Fi credentials are missing, so the device still boots and the
/// UI is exercisable without a backend (matches Feedme).
class NoopNetwork : public howler::application::INetwork {
public:
    bool isOnline() const override { return false; }
    bool fetchPending(std::vector<howler::domain::Occurrence>&) override { return false; }
    bool postAck(const std::string&, const std::string&) override { return false; }
    bool postHeartbeat(const std::string&) override { return false; }
};

}  // namespace howler::adapters
