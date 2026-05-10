#include "OtaService.h"

#include "../domain/Version.h"

namespace howler::application {

void OtaService::tick() {
    // Reboot-grace path: image flashed, screen showed "rebooting...",
    // now actually pull the trigger. We don't reboot from the same
    // tick the flash returns ok in because LVGL needs at least one
    // more frame to paint the confirmation overlay. State==Flashed
    // implies runApply() ran and seeded flashedAtMs_, so no extra
    // sentinel guard is needed.
    if (state_ == State::Flashed) {
        const int64_t now = clock_.nowEpochMillis();
        if (now - flashedAtMs_ >= kRebootGraceMs) {
            ota_.reboot();
            // Unreachable on hardware; the host stub returns and
            // we stay in Flashed so the test can assert the call.
            return;
        }
    }

    if (checkRequested_) {
        checkRequested_ = false;
        runCheck();
    }
    if (applyRequested_) {
        applyRequested_ = false;
        runApply();
    }
}

void OtaService::requestCheck() {
    // While a download is in flight, don't let a stray "check again"
    // tap pull the rug out — the operation is blocking and we'd
    // never reach the flag-clear anyway. Other states are fine to
    // re-check from.
    if (state_ == State::Downloading) return;
    checkRequested_ = true;
    errorMsg_.clear();
}

void OtaService::requestApply() {
    if (state_ != State::UpdateAvailable) return;
    applyRequested_ = true;
}

void OtaService::reset() {
    state_ = State::Idle;
    checkRequested_ = false;
    applyRequested_ = false;
    progressPct_ = -1;
    flashedAtMs_ = 0;
    errorMsg_.clear();
    advisory_ = {};
}

void OtaService::runCheck() {
    state_ = State::Checking;
    advisory_ = {};
    errorMsg_.clear();

    if (!net_.isOnline()) {
        state_ = State::Failed;
        errorMsg_ = "offline";
        return;
    }

    howler::domain::UpdateAdvisory adv;
    const auto r = net_.checkFirmwareUpdate(fwVersion_, adv);
    if (!r.isOk()) {
        state_ = State::Failed;
        // 4xx → "rejected" so the user knows it wasn't a flaky
        // network. Anything else (transient or mid-stream) →
        // "network", retryable.
        errorMsg_ =
            r.kind == NetResult::Kind::Permanent ? "rejected" : "network";
        return;
    }

    if (!adv.updateAvailable) {
        state_ = State::UpToDate;
        return;
    }

    // Defense-in-depth — re-verify the advisory against our known
    // version locally. A stale rollout rule pinning a downlevel
    // build shouldn't be able to roll us backwards even if the
    // server fails to filter it out.
    if (howler::domain::compareVersions(adv.version, fwVersion_) <= 0) {
        state_ = State::UpToDate;
        return;
    }

    advisory_ = std::move(adv);
    state_ = State::UpdateAvailable;
}

void OtaService::runApply() {
    if (advisory_.downloadUrl.empty() || advisory_.sha256.empty()) {
        state_ = State::Failed;
        errorMsg_ = "no-download-url";
        return;
    }

    state_ = State::Downloading;
    progressPct_ = 0;

    auto progress = [this](int64_t written, int64_t total) {
        if (total > 0) {
            const int64_t pct = (written * 100) / total;
            progressPct_ = static_cast<int>(pct < 0 ? 0 : (pct > 100 ? 100 : pct));
        } else {
            progressPct_ = -1;
        }
    };

    const auto result = ota_.downloadAndFlash(advisory_, progress);
    if (result == IOtaPort::Result::Ok) {
        state_ = State::Flashed;
        progressPct_ = 100;
        flashedAtMs_ = clock_.nowEpochMillis();
        return;
    }

    state_ = State::Failed;
    errorMsg_ = mapOtaError(result);
    progressPct_ = -1;
}

const char* OtaService::mapOtaError(IOtaPort::Result r) {
    switch (r) {
        case IOtaPort::Result::Ok:            return "ok";
        case IOtaPort::Result::NetworkError:  return "network";
        case IOtaPort::Result::VerifyError:   return "verify";
        case IOtaPort::Result::FlashError:    return "flash";
        case IOtaPort::Result::NotConfigured: return "no-ota";
    }
    return "unknown";
}

}  // namespace howler::application
