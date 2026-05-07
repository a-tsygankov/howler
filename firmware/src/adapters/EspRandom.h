#pragma once

#include "../application/Ports.h"

#include <Arduino.h>
#include <esp_random.h>

namespace howler::adapters {

class EspRandom : public howler::application::IRandom {
public:
    std::string newUuidHex() override {
        static const char hex[] = "0123456789abcdef";
        std::string out;
        out.resize(32);
        for (int i = 0; i < 32; i += 8) {
            const uint32_t r = esp_random();
            out[i + 0] = hex[(r >> 28) & 0xF];
            out[i + 1] = hex[(r >> 24) & 0xF];
            out[i + 2] = hex[(r >> 20) & 0xF];
            out[i + 3] = hex[(r >> 16) & 0xF];
            out[i + 4] = hex[(r >> 12) & 0xF];
            out[i + 5] = hex[(r >> 8) & 0xF];
            out[i + 6] = hex[(r >> 4) & 0xF];
            out[i + 7] = hex[r & 0xF];
        }
        return out;
    }
};

}  // namespace howler::adapters
