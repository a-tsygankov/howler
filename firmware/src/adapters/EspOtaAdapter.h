#pragma once

// Phase 6 OTA slice F4 — hardware adapter for IOtaPort. Wraps
// esp_https_ota for the download + flash, mbedTLS SHA-256 for the
// hash verify, and the ESP-IDF ota_data partition machinery for
// boot-slot swap + slice-F5 pending-verify.
//
// Header is .cpp-light: all the ESP-IDF includes (esp_ota_ops.h,
// esp_https_ota.h, esp_app_format.h, mbedtls/sha256.h) live in the
// .cpp so host tests that include this header don't blow up on
// missing toolchain headers. The class definition stays public
// because main.cpp instantiates it.

#include "../application/Ports.h"

#include <string>

namespace howler::adapters {

class EspOtaAdapter : public howler::application::IOtaPort {
public:
    EspOtaAdapter() = default;

    Result downloadAndFlash(
        const howler::domain::UpdateAdvisory& advisory,
        const ProgressFn& onProgress) override;

    void reboot() override;

    bool isPendingVerify() const override;
    void markValid() override;
};

}  // namespace howler::adapters
