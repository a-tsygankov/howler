#pragma once

#include "../application/Ports.h"
#include <Arduino.h>
#include <time.h>

namespace howler::adapters {

class ArduinoClock : public howler::application::IClock {
public:
    int64_t nowEpochMillis() const override {
        return static_cast<int64_t>(millis());
    }

    int64_t nowEpochSeconds() const override {
        // Once SNTP has synced, time(nullptr) returns wall-clock
        // seconds. Before sync it returns 0 — we fall back to the
        // monotonic millis()/1000 so timestamps remain monotonic
        // (the server is forgiving here; offline-queued executions
        // can have any int64 ts and the dashboard recomputes urgency).
        const time_t t = time(nullptr);
        if (t > 1700000000) return static_cast<int64_t>(t);
        return static_cast<int64_t>(millis() / 1000);
    }
};

}  // namespace howler::adapters
