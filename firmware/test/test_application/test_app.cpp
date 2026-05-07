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

}  // namespace

void test_app_first_boot_lands_on_pair_screen() {
    StubClock clock;
    StubNetwork net;
    StubPairApi pairApi;
    StubRandom rng;
    StubStorage storage;
    StubInput input;

    App app(net, pairApi, clock, rng, storage, input, "deviceA");
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

    App app(net, pairApi, clock, rng, storage, input, "deviceA");
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

    App app(net, pairApi, clock, rng, storage, input, "deviceA");
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

    App app(net, pairApi, clock, rng, storage, input, "deviceA");
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
