#pragma once

// Pure-virtual ports the application layer depends on. Concrete
// adapters live in src/adapters/. Native tests use Stub*/Noop*
// variants from there too.

#include "../domain/Occurrence.h"
#include <cstdint>
#include <string>
#include <vector>

namespace howler::application {

class IClock {
public:
    virtual ~IClock() = default;
    virtual int64_t nowEpochMillis() const = 0;
};

class INetwork {
public:
    virtual ~INetwork() = default;
    virtual bool isOnline() const = 0;
    virtual bool fetchPending(std::vector<howler::domain::Occurrence>& out) = 0;
    virtual bool postAck(const std::string& occurrenceId,
                         const std::string& idempotencyKey) = 0;
    virtual bool postHeartbeat(const std::string& fwVersion) = 0;
};

class IInputDevice {
public:
    enum class Event : uint8_t { None, RotateCW, RotateCCW, Press, LongPress };
    virtual ~IInputDevice() = default;
    virtual Event poll() = 0;
};

class IDisplay {
public:
    virtual ~IDisplay() = default;
    virtual void tick(uint32_t millis) = 0;
};

}  // namespace howler::application
