#pragma once

#include "../application/Ports.h"

namespace howler::adapters {

/// Phase 1: HTTPS REST polling against the Worker. Filled out alongside
/// device pairing + token storage. For now the constructor exists so
/// main.cpp can wire it in conditionally.
class WifiNetwork : public howler::application::INetwork {
public:
    WifiNetwork(const char* backendUrl, const char* deviceToken)
        : backendUrl_(backendUrl), deviceToken_(deviceToken) {}

    bool isOnline() const override { return false; }   // Phase 1
    bool fetchPending(std::vector<howler::domain::Occurrence>&) override { return false; }
    bool postAck(const std::string&, const std::string&) override { return false; }
    bool postHeartbeat(const std::string&) override { return false; }

private:
    const char* backendUrl_;
    const char* deviceToken_;
};

}  // namespace howler::adapters
