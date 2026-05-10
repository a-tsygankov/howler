#include <unity.h>

#include "../../src/application/OtaService.h"
#include "stubs.h"

using howler::application::IOtaPort;
using howler::application::NetResult;
using howler::application::OtaService;
using howler::testing::StubClock;
using howler::testing::StubNetwork;
using howler::testing::StubOtaPort;

namespace {

howler::domain::UpdateAdvisory makeAdvisory(const char* version,
                                            int64_t sizeBytes = 1500000) {
    howler::domain::UpdateAdvisory adv;
    adv.updateAvailable = true;
    adv.version = version;
    adv.sha256 =
        "0123456789abcdef0123456789abcdef"
        "0123456789abcdef0123456789abcdef";
    adv.sizeBytes = sizeBytes;
    adv.downloadUrl = "https://r2.example/firmware.bin?sig=abc";
    adv.downloadUrlExpiresInSec = 300;
    return adv;
}

}  // namespace

void test_ota_idle_until_check_requested() {
    StubClock clock;
    StubNetwork net;
    StubOtaPort ota;
    OtaService svc(net, ota, clock, "0.3.0");
    TEST_ASSERT_EQUAL(static_cast<int>(OtaService::State::Idle),
                      static_cast<int>(svc.state()));
    svc.tick();  // no requests pending → still Idle
    TEST_ASSERT_EQUAL(static_cast<int>(OtaService::State::Idle),
                      static_cast<int>(svc.state()));
    TEST_ASSERT_EQUAL(0, net.firmwareCheckCalls_);
}

void test_ota_check_no_update_lands_in_uptodate() {
    StubClock clock;
    StubNetwork net;
    StubOtaPort ota;
    net.nextAdvisory_.updateAvailable = false;

    OtaService svc(net, ota, clock, "0.3.0");
    svc.requestCheck();
    svc.tick();
    TEST_ASSERT_EQUAL(static_cast<int>(OtaService::State::UpToDate),
                      static_cast<int>(svc.state()));
    TEST_ASSERT_EQUAL(1, net.firmwareCheckCalls_);
    TEST_ASSERT_EQUAL_STRING("0.3.0", net.lastCheckedVersion_.c_str());
}

void test_ota_check_advisory_lands_in_update_available() {
    StubClock clock;
    StubNetwork net;
    StubOtaPort ota;
    net.nextAdvisory_ = makeAdvisory("0.4.0");

    OtaService svc(net, ota, clock, "0.3.0");
    svc.requestCheck();
    svc.tick();
    TEST_ASSERT_EQUAL(static_cast<int>(OtaService::State::UpdateAvailable),
                      static_cast<int>(svc.state()));
    TEST_ASSERT_EQUAL_STRING("0.4.0", svc.advisory().version.c_str());
}

void test_ota_check_rejects_downlevel_advisory_locally() {
    // Defense-in-depth: the server says "update available" but the
    // advised version isn't actually newer than what we're running.
    // OtaService re-runs compareVersions and lands UpToDate instead.
    StubClock clock;
    StubNetwork net;
    StubOtaPort ota;
    net.nextAdvisory_ = makeAdvisory("0.2.0");

    OtaService svc(net, ota, clock, "0.3.0");
    svc.requestCheck();
    svc.tick();
    TEST_ASSERT_EQUAL(static_cast<int>(OtaService::State::UpToDate),
                      static_cast<int>(svc.state()));
}

void test_ota_check_offline_lands_in_failed_with_offline_message() {
    StubClock clock;
    StubNetwork net;
    StubOtaPort ota;
    net.setOnline(false);

    OtaService svc(net, ota, clock, "0.3.0");
    svc.requestCheck();
    svc.tick();
    TEST_ASSERT_EQUAL(static_cast<int>(OtaService::State::Failed),
                      static_cast<int>(svc.state()));
    TEST_ASSERT_EQUAL_STRING("offline", svc.errorMessage().c_str());
    TEST_ASSERT_EQUAL(0, net.firmwareCheckCalls_);
}

void test_ota_check_transient_error_is_retryable() {
    StubClock clock;
    StubNetwork net;
    StubOtaPort ota;
    net.firmwareCheckResults_.push_back(NetResult::transient(503));

    OtaService svc(net, ota, clock, "0.3.0");
    svc.requestCheck();
    svc.tick();
    TEST_ASSERT_EQUAL(static_cast<int>(OtaService::State::Failed),
                      static_cast<int>(svc.state()));
    TEST_ASSERT_EQUAL_STRING("network", svc.errorMessage().c_str());

    // Re-request → next tick clears the message and tries again.
    net.nextAdvisory_ = makeAdvisory("0.4.0");
    svc.requestCheck();
    svc.tick();
    TEST_ASSERT_EQUAL(static_cast<int>(OtaService::State::UpdateAvailable),
                      static_cast<int>(svc.state()));
    TEST_ASSERT_EQUAL_STRING("", svc.errorMessage().c_str());
}

void test_ota_apply_succeeds_lands_flashed_then_reboots() {
    StubClock clock;
    StubNetwork net;
    StubOtaPort ota;
    net.nextAdvisory_ = makeAdvisory("0.4.0");
    ota.nextResult_ = IOtaPort::Result::Ok;

    OtaService svc(net, ota, clock, "0.3.0");
    svc.requestCheck();
    svc.tick();
    TEST_ASSERT_EQUAL(static_cast<int>(OtaService::State::UpdateAvailable),
                      static_cast<int>(svc.state()));

    svc.requestApply();
    svc.tick();
    TEST_ASSERT_EQUAL(static_cast<int>(OtaService::State::Flashed),
                      static_cast<int>(svc.state()));
    TEST_ASSERT_EQUAL(1, ota.downloadCalls_);
    TEST_ASSERT_EQUAL_STRING("0.4.0", ota.lastAdvisory_.version.c_str());
    TEST_ASSERT_EQUAL(0, ota.rebootCalls_);  // grace not elapsed yet

    // Sub-grace tick — still no reboot.
    clock.advance(500);
    svc.tick();
    TEST_ASSERT_EQUAL(0, ota.rebootCalls_);

    // Past the grace — reboot fires.
    clock.advance(2000);
    svc.tick();
    TEST_ASSERT_EQUAL(1, ota.rebootCalls_);
}

void test_ota_apply_failure_lands_failed_with_mapped_message() {
    StubClock clock;
    StubNetwork net;
    StubOtaPort ota;
    net.nextAdvisory_ = makeAdvisory("0.4.0");
    ota.nextResult_ = IOtaPort::Result::VerifyError;

    OtaService svc(net, ota, clock, "0.3.0");
    svc.requestCheck();
    svc.tick();
    svc.requestApply();
    svc.tick();
    TEST_ASSERT_EQUAL(static_cast<int>(OtaService::State::Failed),
                      static_cast<int>(svc.state()));
    TEST_ASSERT_EQUAL_STRING("verify", svc.errorMessage().c_str());
    TEST_ASSERT_EQUAL(0, ota.rebootCalls_);
}

void test_ota_apply_ignored_when_not_in_update_available_state() {
    StubClock clock;
    StubNetwork net;
    StubOtaPort ota;

    OtaService svc(net, ota, clock, "0.3.0");
    svc.requestApply();  // no advisory yet
    svc.tick();
    TEST_ASSERT_EQUAL(0, ota.downloadCalls_);
    TEST_ASSERT_EQUAL(static_cast<int>(OtaService::State::Idle),
                      static_cast<int>(svc.state()));
}

void test_ota_pending_verify_forwards_to_adapter() {
    StubClock clock;
    StubNetwork net;
    StubOtaPort ota;
    ota.pendingVerify_ = true;

    OtaService svc(net, ota, clock, "0.4.0");
    TEST_ASSERT_TRUE(svc.isPendingVerify());

    svc.markRunningBuildValid();
    TEST_ASSERT_FALSE(svc.isPendingVerify());
    TEST_ASSERT_EQUAL(1, ota.markValidCalls_);
}

void test_ota_reset_clears_state_and_advisory() {
    StubClock clock;
    StubNetwork net;
    StubOtaPort ota;
    net.nextAdvisory_ = makeAdvisory("0.4.0");

    OtaService svc(net, ota, clock, "0.3.0");
    svc.requestCheck();
    svc.tick();
    TEST_ASSERT_EQUAL(static_cast<int>(OtaService::State::UpdateAvailable),
                      static_cast<int>(svc.state()));

    svc.reset();
    TEST_ASSERT_EQUAL(static_cast<int>(OtaService::State::Idle),
                      static_cast<int>(svc.state()));
    TEST_ASSERT_FALSE(svc.advisory().updateAvailable);
}
