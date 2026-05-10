#include <unity.h>

#include "../../src/application/App.h"
#include "stubs.h"

using howler::application::App;
using howler::application::IInputDevice;
using howler::application::NetResult;
using howler::application::PairCoordinator;
using howler::domain::PairPhase;
using howler::domain::ScreenId;
using howler::domain::TaskId;
using howler::testing::StubClock;
using howler::testing::StubNetwork;
using howler::testing::StubPairApi;
using howler::testing::StubRandom;
using howler::testing::StubStorage;

namespace {

class StubInput : public IInputDevice {
public:
    Event poll() override { return Event::None; }
};

class StubWifi : public howler::application::IWifi {
public:
    bool isConnected() const override { return connected_; }
    std::string currentSsid() const override { return ssid_; }
    bool scan(std::vector<howler::domain::WifiNetwork>& out) override {
        out = scanResult_; return scanOk_;
    }
    bool connect(const howler::domain::WifiConfig& cfg) override {
        ssid_ = cfg.ssid;
        connected_ = connectOk_;
        return connectOk_;
    }
    void disconnect() override { connected_ = false; }

    bool connected_ = false;
    std::string ssid_;
    bool scanOk_ = true;
    std::vector<howler::domain::WifiNetwork> scanResult_;
    bool connectOk_ = true;
};

}  // namespace

void test_app_first_boot_lands_on_pair_screen() {
    StubClock clock;
    StubNetwork net;
    StubPairApi pairApi;
    StubRandom rng;
    StubStorage storage;
    StubInput input;

    StubWifi wifi;
    howler::application::NoopLedRing led;
    howler::application::NoopOtaPort ota;
    App app(net, pairApi, clock, rng, storage, input, wifi, led, ota, "deviceA");
    app.begin();
    TEST_ASSERT_EQUAL(static_cast<int>(ScreenId::Pair),
                      static_cast<int>(app.router().current()));
    TEST_ASSERT_EQUAL(static_cast<int>(PairPhase::Started),
                      static_cast<int>(app.pair().state().phase));
}

void test_app_paired_token_lands_on_dashboard() {
    StubClock clock;
    StubNetwork net;
    StubPairApi pairApi;
    StubRandom rng;
    StubStorage storage;
    StubInput input;
    storage.writeBlob(PairCoordinator::kTokenKey, "existing-token");

    StubWifi wifi;
    howler::application::NoopLedRing led;
    howler::application::NoopOtaPort ota;
    App app(net, pairApi, clock, rng, storage, input, wifi, led, ota, "deviceA");
    app.begin();
    TEST_ASSERT_EQUAL(static_cast<int>(ScreenId::Dashboard),
                      static_cast<int>(app.router().current()));
}

void test_app_pair_confirm_swaps_to_dashboard() {
    StubClock clock;
    StubNetwork net;
    StubPairApi pairApi;
    StubRandom rng;
    StubStorage storage;
    StubInput input;
    pairApi.checkPhase_ = PairPhase::Confirmed;
    pairApi.checkToken_ = "tok-xyz";

    StubWifi wifi;
    howler::application::NoopLedRing led;
    howler::application::NoopOtaPort ota;
    App app(net, pairApi, clock, rng, storage, input, wifi, led, ota, "deviceA");
    app.begin();
    TEST_ASSERT_EQUAL(static_cast<int>(ScreenId::Pair),
                      static_cast<int>(app.router().current()));
    clock.advance(10'000);
    app.tick(static_cast<uint32_t>(clock.nowEpochMillis()));
    TEST_ASSERT_EQUAL(static_cast<int>(ScreenId::Dashboard),
                      static_cast<int>(app.router().current()));
}

void test_app_commit_pending_done_drops_dashboard_row() {
    StubClock clock;
    StubNetwork net;
    StubPairApi pairApi;
    StubRandom rng;
    StubStorage storage;
    StubInput input;
    storage.writeBlob(PairCoordinator::kTokenKey, "tok");

    StubWifi wifi;
    howler::application::NoopLedRing led;
    howler::application::NoopOtaPort ota;
    App app(net, pairApi, clock, rng, storage, input, wifi, led, ota, "deviceA");
    app.begin();
    // Seed the dashboard with one item, then commit a done.
    howler::domain::DashboardItem d;
    d.id = "task-1";
    d.taskId = TaskId("task-1");
    d.occurrenceId = "";
    d.title = "feed";
    d.urgency = howler::domain::Urgency::Urgent;
    d.dueAt = 0;
    d.priority = 1;
    app.dashboard().replace({d});
    TEST_ASSERT_EQUAL_size_t(1, app.dashboard().size());

    app.pendingDone().taskId = TaskId("task-1");
    app.pendingDone().occurrenceId = "";
    app.pendingDone().userId = "user-1";
    app.commitPendingDone();
    TEST_ASSERT_EQUAL_size_t(0, app.dashboard().size());
    TEST_ASSERT_EQUAL_size_t(1, app.queue().size());
}

void test_app_wifi_scan_populates_list() {
    StubClock clock;
    StubNetwork net;
    StubPairApi pairApi;
    StubRandom rng;
    StubStorage storage;
    StubInput input;
    StubWifi wifi;
    howler::domain::WifiNetwork w; w.ssid = "home"; w.rssi = -50; w.secured = true;
    wifi.scanResult_ = { w };

    howler::application::NoopLedRing led;
    howler::application::NoopOtaPort ota;
    App app(net, pairApi, clock, rng, storage, input, wifi, led, ota, "deviceA");
    app.begin();
    TEST_ASSERT_TRUE(app.refreshWifiScan());
    TEST_ASSERT_EQUAL_size_t(1, app.wifiScan().size());
    TEST_ASSERT_EQUAL_STRING("home", app.wifiScan()[0].ssid.c_str());
}

void test_app_wifi_save_persists_and_connects() {
    StubClock clock;
    StubNetwork net;
    StubPairApi pairApi;
    StubRandom rng;
    StubStorage storage;
    StubInput input;
    StubWifi wifi;

    howler::application::NoopLedRing led;
    howler::application::NoopOtaPort ota;
    App app(net, pairApi, clock, rng, storage, input, wifi, led, ota, "deviceA");
    app.begin();
    howler::domain::WifiConfig cfg;
    cfg.ssid = "home";
    cfg.secret = "hunter2";
    TEST_ASSERT_TRUE(app.saveAndConnectWifi(cfg));
    TEST_ASSERT_TRUE(wifi.isConnected());
    std::string blob;
    TEST_ASSERT_TRUE(storage.readBlob("howler.wifi", blob));
    TEST_ASSERT_TRUE(blob.find("home") != std::string::npos);
    TEST_ASSERT_TRUE(blob.find("hunter2") != std::string::npos);
}
