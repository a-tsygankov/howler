#include "EspOtaAdapter.h"

#include <Arduino.h>
#include <esp_app_format.h>
#include <esp_https_ota.h>
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include <mbedtls/sha256.h>

#include <cstring>

namespace howler::adapters {

namespace {

// Hex → bytes for the 64-char sha256 string carried by the
// advisory. Returns false on a malformed input (non-hex char or
// wrong length); caller treats that as a verification failure.
bool hexToBytes32(const std::string& hex, uint8_t out[32]) {
    if (hex.size() != 64) return false;
    for (int i = 0; i < 32; ++i) {
        char buf[3] = {hex[i * 2], hex[i * 2 + 1], 0};
        char* end = nullptr;
        const unsigned long v = strtoul(buf, &end, 16);
        if (end != buf + 2) return false;
        out[i] = static_cast<uint8_t>(v);
    }
    return true;
}

// Streamed sha256 over the inactive partition's bytes. The ESP-IDF
// mbedtls bindings return `void` (errors panic via assertion), so
// the only failure modes we care about are partition_read errors
// and the final byte-comparison.
bool sha256Verify(const esp_partition_t* part,
                  size_t imageSize,
                  const std::string& expectedHex) {
    uint8_t expected[32];
    if (!hexToBytes32(expectedHex, expected)) return false;

    mbedtls_sha256_context ctx;
    mbedtls_sha256_init(&ctx);
    mbedtls_sha256_starts(&ctx, /*is224=*/0);

    constexpr size_t kBuf = 1024;
    uint8_t buf[kBuf];
    size_t off = 0;
    while (off < imageSize) {
        const size_t want = imageSize - off > kBuf ? kBuf : imageSize - off;
        if (esp_partition_read(part, off, buf, want) != ESP_OK) {
            mbedtls_sha256_free(&ctx);
            return false;
        }
        mbedtls_sha256_update(&ctx, buf, want);
        off += want;
    }
    uint8_t got[32];
    mbedtls_sha256_finish(&ctx, got);
    mbedtls_sha256_free(&ctx);
    return memcmp(got, expected, 32) == 0;
}

}  // namespace

EspOtaAdapter::Result EspOtaAdapter::downloadAndFlash(
    const howler::domain::UpdateAdvisory& advisory,
    const ProgressFn& onProgress) {
    if (advisory.downloadUrl.empty() || advisory.sha256.size() != 64) {
        return Result::NotConfigured;
    }

    // Verify the staging slot exists. On the legacy single-app
    // partition table there's no second OTA slot, so flashes via
    // OTA aren't possible — fail closed.
    const esp_partition_t* nextSlot = esp_ota_get_next_update_partition(nullptr);
    if (!nextSlot) {
        return Result::NotConfigured;
    }

    // esp_https_ota config. cert_pem = NULL + skip_cert_common_name_check
    // mirrors WifiNetwork::doGet's setInsecure() — Phase 1 doesn't
    // pin certs; OTA bytes are protected by sha256 + (slice F2)
    // RSA detached signature, not TLS pinning. Plan §10 #3 tracks
    // the pin-the-CA upgrade.
    esp_http_client_config_t http_cfg = {};
    http_cfg.url = advisory.downloadUrl.c_str();
    http_cfg.timeout_ms = 30000;
    http_cfg.keep_alive_enable = true;
    http_cfg.skip_cert_common_name_check = true;

    esp_https_ota_config_t ota_cfg = {};
    ota_cfg.http_config = &http_cfg;

    esp_https_ota_handle_t handle = nullptr;
    if (esp_https_ota_begin(&ota_cfg, &handle) != ESP_OK || !handle) {
        return Result::NetworkError;
    }

    esp_err_t err = ESP_OK;
    while (true) {
        err = esp_https_ota_perform(handle);
        if (err != ESP_ERR_HTTPS_OTA_IN_PROGRESS) break;
        if (onProgress) {
            const int64_t written = esp_https_ota_get_image_len_read(handle);
            onProgress(written, advisory.sizeBytes);
        }
        // Yield so LVGL keeps animating the progress overlay.
        delay(1);
    }

    if (err != ESP_OK) {
        esp_https_ota_abort(handle);
        return Result::NetworkError;
    }

    // ESP-IDF has already validated the image header; now verify the
    // bytes we wrote against the advisory's sha256 before we let the
    // bootloader switch slots. esp_https_ota_finish would otherwise
    // commit the slot regardless of whether bytes match what the CI
    // signed.
    const size_t imageSize = esp_https_ota_get_image_len_read(handle);
    if (imageSize == 0) {
        esp_https_ota_abort(handle);
        return Result::VerifyError;
    }
    if (!sha256Verify(nextSlot, imageSize, advisory.sha256)) {
        esp_https_ota_abort(handle);
        return Result::VerifyError;
    }

    if (esp_https_ota_finish(handle) != ESP_OK) {
        return Result::FlashError;
    }
    return Result::Ok;
}

void EspOtaAdapter::reboot() {
    esp_restart();
}

bool EspOtaAdapter::isPendingVerify() const {
    const esp_partition_t* running = esp_ota_get_running_partition();
    if (!running) return false;
    esp_ota_img_states_t state = ESP_OTA_IMG_UNDEFINED;
    if (esp_ota_get_state_partition(running, &state) != ESP_OK) return false;
    return state == ESP_OTA_IMG_PENDING_VERIFY;
}

void EspOtaAdapter::markValid() {
    // Idempotent — safe to call on every successful sync round.
    // ESP-IDF returns ESP_FAIL when the partition isn't actually
    // pending-verify, which we silently ignore (no-op intent).
    esp_ota_mark_app_valid_cancel_rollback();
}

}  // namespace howler::adapters
