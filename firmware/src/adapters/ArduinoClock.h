#pragma once

#include "../application/Ports.h"
#include <Arduino.h>

namespace howler::adapters {

class ArduinoClock : public howler::application::IClock {
public:
    int64_t nowEpochMillis() const override { return static_cast<int64_t>(millis()); }
};

}  // namespace howler::adapters
