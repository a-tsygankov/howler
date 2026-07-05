#include <unity.h>

#include "../../src/application/SyncService.h"
#include "../../src/domain/DashboardModel.h"
#include "../../src/domain/HomeIdentity.h"
#include "../../src/domain/OccurrenceList.h"
#include "../../src/domain/SyncWatermark.h"
#include "stubs.h"

using howler::application::SyncService;
using howler::domain::DashboardItem;
using howler::domain::DashboardModel;
using howler::domain::DeviceIdentity;
using howler::domain::HomeIdentity;
using howler::domain::OccurrenceList;
using howler::domain::ResultType;
using howler::domain::SyncWatermark;
using howler::domain::User;
using howler::testing::StubClock;
using howler::testing::StubNetwork;
using howler::testing::StubStorage;

void test_sync_populates_home_identity_on_full_round() {
    // Avatar sweep: every full sync round refreshes the cached
    // HomeIdentity so the device's Settings → About card reflects
    // server-side renames / avatar swaps within one sync cycle.
    StubClock clock;
    clock.setMs(1'000'000);
    StubNetwork net;
    net.setOnline(true);

    HomeIdentity hi;          // reference passed into SyncService
    DeviceIdentity di;
    DashboardModel dash;
    DashboardModel allTasks;
    OccurrenceList occ;
    std::vector<User> users;
    std::vector<ResultType> types;
    SyncWatermark wm;
    StubStorage storage;

    // Seed the stub network's "next identity" — the round's
    // fetchHomeIdentity() will copy this into the reference.
    net.nextHomeIdentity_.id = "home-32-hex-id";
    net.nextHomeIdentity_.displayName = "The Smiths";
    net.nextHomeIdentity_.avatarId = "icon:home";
    net.nextHomeIdentity_.tz = "America/Los_Angeles";
    net.dashboardResults_  = { howler::application::NetResult::ok() };
    net.userResults_       = { howler::application::NetResult::ok() };
    net.resultTypeResults_ = { howler::application::NetResult::ok() };
    net.pendingResults_    = { howler::application::NetResult::ok() };

    SyncService s(net, clock, storage, occ, dash, allTasks, users, types, wm, hi, di);
    s.requestSync();
    s.tick();

    TEST_ASSERT_EQUAL(1, net.homeIdentityCalls_);
    TEST_ASSERT_EQUAL_STRING("The Smiths", hi.displayName.c_str());
    TEST_ASSERT_EQUAL_STRING("icon:home",  hi.avatarId.c_str());
    TEST_ASSERT_EQUAL_STRING("America/Los_Angeles", hi.tz.c_str());
}

void test_sync_populates_device_identity_on_full_round() {
    // A full round also refreshes THIS device's identity (its
    // user-set name) so a webapp rename shows on the About card
    // within one sync cycle.
    StubClock clock;
    clock.setMs(1'000'000);
    StubNetwork net;
    net.setOnline(true);

    HomeIdentity hi;
    DeviceIdentity di;
    DashboardModel dash;
    DashboardModel allTasks;
    OccurrenceList occ;
    std::vector<User> users;
    std::vector<ResultType> types;
    SyncWatermark wm;
    StubStorage storage;

    net.nextDeviceIdentity_.id = "device-32-hex-id";
    net.nextDeviceIdentity_.name = "Kitchen Dial";
    net.nextDeviceIdentity_.serial = "SER123";
    net.nextDeviceIdentity_.hwModel = "DIAL";
    net.dashboardResults_  = { howler::application::NetResult::ok() };
    net.userResults_       = { howler::application::NetResult::ok() };
    net.resultTypeResults_ = { howler::application::NetResult::ok() };
    net.pendingResults_    = { howler::application::NetResult::ok() };

    SyncService s(net, clock, storage, occ, dash, allTasks, users, types, wm, hi, di);
    s.requestSync();
    s.tick();

    TEST_ASSERT_EQUAL(1, net.deviceIdentityCalls_);
    TEST_ASSERT_EQUAL_STRING("Kitchen Dial", di.name.c_str());
    TEST_ASSERT_EQUAL_STRING("DIAL", di.hwModel.c_str());
}

void test_sync_keeps_cached_identity_on_fetch_failure() {
    // Failure path: the dashboard / users / types / pending fetches
    // succeed but fetchHomeIdentity returns transient. The cached
    // HomeIdentity from a previous successful round (or the empty
    // default) MUST stay intact — we never want a network blip to
    // erase the home name from the About screen.
    StubClock clock;
    clock.setMs(1'000'000);
    StubNetwork net;
    net.setOnline(true);

    HomeIdentity hi;
    DeviceIdentity di;
    hi.displayName = "The Smiths";    // pre-populated cache
    hi.avatarId    = "icon:home";

    DashboardModel dash;
    DashboardModel allTasks;
    OccurrenceList occ;
    std::vector<User> users;
    std::vector<ResultType> types;
    SyncWatermark wm;
    StubStorage storage;

    net.dashboardResults_     = { howler::application::NetResult::ok() };
    net.userResults_          = { howler::application::NetResult::ok() };
    net.resultTypeResults_    = { howler::application::NetResult::ok() };
    net.pendingResults_       = { howler::application::NetResult::ok() };
    net.homeIdentityResults_  = { howler::application::NetResult::transient(503) };

    SyncService s(net, clock, storage, occ, dash, allTasks, users, types, wm, hi, di);
    s.requestSync();
    s.tick();

    TEST_ASSERT_EQUAL(1, net.homeIdentityCalls_);
    // Cache survived — the screen will keep rendering "The Smiths"
    // through the next round's retry.
    TEST_ASSERT_EQUAL_STRING("The Smiths", hi.displayName.c_str());
    TEST_ASSERT_EQUAL_STRING("icon:home",  hi.avatarId.c_str());
}

void test_sync_no_op_when_offline() {
    StubClock clock;
    StubNetwork net;
    net.setOnline(false);
    DashboardModel dash;
    OccurrenceList occ;
    std::vector<User> users;
    std::vector<ResultType> types;
    SyncWatermark wm;
    DashboardModel allTasks;
    HomeIdentity hi;
    DeviceIdentity di;
    StubStorage storage;
    SyncService s(net, clock, storage, occ, dash, allTasks, users, types, wm, hi, di);
    s.tick();
    TEST_ASSERT_EQUAL_size_t(0, dash.size());
    TEST_ASSERT_FALSE(s.lastSyncOk());
}

void test_sync_replaces_dashboard_users_result_types() {
    StubClock clock;
    clock.setMs(1'000'000);
    StubNetwork net;
    net.setOnline(true);

    DashboardItem d;
    d.id = "t1";
    d.title = "feed";
    d.urgency = howler::domain::Urgency::Urgent;
    d.dueAt = 100;
    d.priority = 1;
    d.isMissed = false;
    d.updatedAt = 5000;
    d.assignedToThisDevice = true;  // lands on the Today dashboard
    net.nextDashboard_ = { d };
    net.dashboardResults_ = { howler::application::NetResult::ok() };

    User u;
    u.id = "u1";
    u.displayName = "Alice";
    u.updatedAt = 4000;
    net.nextUsers_ = { u };
    net.userResults_ = { howler::application::NetResult::ok() };

    ResultType rt{};
    rt.id = "r1";
    rt.displayName = "grams";
    rt.unitName = "g";
    rt.step = 1.0;
    rt.updatedAt = 3000;
    net.nextResultTypes_ = { rt };
    net.resultTypeResults_ = { howler::application::NetResult::ok() };

    net.pendingResults_ = { howler::application::NetResult::ok() };

    DashboardModel dash;
    OccurrenceList occ;
    std::vector<User> users;
    std::vector<ResultType> types;
    SyncWatermark wm;
    DashboardModel allTasks;
    HomeIdentity hi;
    DeviceIdentity di;
    StubStorage storage;
    SyncService s(net, clock, storage, occ, dash, allTasks, users, types, wm, hi, di);
    s.requestSync();
    s.tick();

    TEST_ASSERT_EQUAL_size_t(1, dash.size());
    TEST_ASSERT_EQUAL_size_t(1, users.size());
    TEST_ASSERT_EQUAL_size_t(1, types.size());
    TEST_ASSERT_EQUAL_INT64(5000, wm.dashboard);
    TEST_ASSERT_EQUAL_INT64(4000, wm.users);
    TEST_ASSERT_EQUAL_INT64(3000, wm.resultTypes);
    TEST_ASSERT_TRUE(s.lastSyncOk());
    TEST_ASSERT_EQUAL_INT64(1000, wm.lastFullSync);
}

// The dial's Today screen shows ONLY tasks assigned to this device;
// the All screen keeps every shared task the server returned. A
// device-token /dashboard payload tags each row with
// `assignedToThisDevice`; SyncService routes on that flag.
void test_sync_today_filters_to_device_assigned_all_keeps_shared() {
    StubClock clock;
    clock.setMs(2'000'000);
    StubNetwork net;
    net.setOnline(true);

    DashboardItem assigned;
    assigned.id = "assigned";
    assigned.title = "sweep";
    assigned.urgency = howler::domain::Urgency::Urgent;
    assigned.dueAt = 100;
    assigned.assignedToThisDevice = true;

    DashboardItem shared;
    shared.id = "shared";
    shared.title = "water";
    shared.urgency = howler::domain::Urgency::Urgent;
    shared.dueAt = 200;
    shared.assignedToThisDevice = false;

    net.nextDashboard_ = { assigned, shared };
    net.dashboardResults_ = { howler::application::NetResult::ok() };

    DashboardModel dash;
    DashboardModel allTasks;
    OccurrenceList occ;
    std::vector<User> users;
    std::vector<ResultType> types;
    SyncWatermark wm;
    HomeIdentity hi;
    DeviceIdentity di;
    StubStorage storage;
    SyncService s(net, clock, storage, occ, dash, allTasks, users, types, wm, hi, di);
    s.requestSync();
    s.tick();

    // Today: only the device-assigned task.
    TEST_ASSERT_EQUAL_size_t(1, dash.size());
    TEST_ASSERT_EQUAL_STRING("assigned", dash.items()[0].id.c_str());
    // All: every shared task the server returned.
    TEST_ASSERT_EQUAL_size_t(2, allTasks.size());
}

void test_sync_respects_interval() {
    StubClock clock;
    StubNetwork net;
    net.setOnline(true);
    net.dashboardResults_ = {
        howler::application::NetResult::ok(),
    };

    DashboardModel dash;
    OccurrenceList occ;
    std::vector<User> users;
    std::vector<ResultType> types;
    SyncWatermark wm;
    DashboardModel allTasks;
    HomeIdentity hi;
    DeviceIdentity di;
    StubStorage storage;
    SyncService s(net, clock, storage, occ, dash, allTasks, users, types, wm, hi, di);
    s.setIntervalMs(1000);
    s.requestSync();  // unblocks the first tick
    s.tick();
    // Second tick within the interval should not re-call fetch (no
    // queued result; if it did, the result would be a transient and
    // lastSyncOk would flip false). Here we simply verify the
    // dashboardResults_ queue is now empty.
    TEST_ASSERT_EQUAL_size_t(0, net.dashboardResults_.size());
    s.tick();
    TEST_ASSERT_EQUAL_size_t(0, net.dashboardResults_.size());  // still empty
}

// Common fixture for the peek-path tests: queue up one full round
// (4 NetResult::ok() entries + matching data), then a counter to
// peek for the second tick. The service should run a full round on
// the first tick (because lastCounter_<0 = first boot) then SKIP
// the four fetches on the second tick when the peek counter
// matches the post-round snapshot.
namespace {
struct SyncFixture {
    StubClock clock;
    StubNetwork net;
    DashboardModel dash;
    OccurrenceList occ;
    std::vector<User> users;
    std::vector<ResultType> types;
    SyncWatermark wm;
    DashboardModel allTasks;
    HomeIdentity hi;
    DeviceIdentity di;
    StubStorage storage;
    SyncService s = SyncService(
        net, clock, storage, occ, dash, allTasks, users, types, wm, hi, di);

    void queueFullRound() {
        net.dashboardResults_.push_back(
            howler::application::NetResult::ok());
        net.userResults_.push_back(
            howler::application::NetResult::ok());
        net.resultTypeResults_.push_back(
            howler::application::NetResult::ok());
        net.pendingResults_.push_back(
            howler::application::NetResult::ok());
    }
};
}  // namespace

void test_sync_skips_fetches_when_peek_counter_unchanged() {
    SyncFixture fx;
    fx.net.setOnline(true);
    fx.clock.setMs(1'000'000);
    fx.s.setIntervalMs(1);  // every tick can run

    // Tick 1: lastCounter_ is -1 (never peeked) → forces a full
    // round even though peek would otherwise gate it. After the
    // round, the service peeks once more to anchor lastCounter_
    // to the server's value (counter=42).
    fx.queueFullRound();
    fx.net.nextCounter_ = 42;
    fx.s.tick();
    TEST_ASSERT_TRUE(fx.s.lastSyncOk());
    TEST_ASSERT_EQUAL_INT64(42, fx.s.lastCounter());
    // 1 post-round peek call so far.
    TEST_ASSERT_EQUAL(1, fx.net.peekCalls_);

    // Tick 2: well inside the 5-min full-refresh window. Server's
    // counter still 42 → peek returns equal → skip the four
    // fetches entirely. queueFullRound is NOT called for this
    // tick; if SyncService incorrectly fetched, the dashboard
    // queue would be empty and we'd see lastSyncOk() flip false.
    fx.clock.setMs(1'010'000);  // +10 s, well under 5 min refresh
    fx.s.tick();
    TEST_ASSERT_TRUE(fx.s.lastSyncOk());
    TEST_ASSERT_EQUAL_INT64(42, fx.s.lastCounter());
    // One additional peek for the gate check, no full-round peek.
    TEST_ASSERT_EQUAL(2, fx.net.peekCalls_);
    // No new fetch results consumed → queues still empty.
    TEST_ASSERT_EQUAL_size_t(0, fx.net.dashboardResults_.size());
}

void test_sync_full_round_when_peek_counter_advances() {
    SyncFixture fx;
    fx.net.setOnline(true);
    fx.clock.setMs(1'000'000);
    fx.s.setIntervalMs(1);

    fx.queueFullRound();
    fx.net.nextCounter_ = 42;
    fx.s.tick();  // first-boot full round → anchors at 42
    TEST_ASSERT_EQUAL_INT64(42, fx.s.lastCounter());

    // Server counter advances: a label was renamed in the webapp
    // during the gap. Peek returns 43, mismatch → full round.
    fx.clock.setMs(1'030'000);
    fx.queueFullRound();
    fx.net.nextCounter_ = 43;
    fx.s.tick();
    TEST_ASSERT_TRUE(fx.s.lastSyncOk());
    TEST_ASSERT_EQUAL_INT64(43, fx.s.lastCounter());
    TEST_ASSERT_EQUAL_size_t(0, fx.net.dashboardResults_.size());
}

void test_sync_full_refresh_after_5min_even_when_counter_unchanged() {
    SyncFixture fx;
    fx.net.setOnline(true);
    fx.clock.setMs(0);
    fx.s.setIntervalMs(1);
    fx.s.setFullRefreshIntervalMs(60'000);  // 1 min for the test

    // First-boot full round.
    fx.queueFullRound();
    fx.net.nextCounter_ = 7;
    fx.s.tick();
    TEST_ASSERT_TRUE(fx.s.lastSyncOk());

    // 30 s later, peek returns the same counter — we should skip.
    fx.clock.setMs(30'000);
    fx.s.tick();
    TEST_ASSERT_TRUE(fx.s.lastSyncOk());
    TEST_ASSERT_EQUAL_size_t(0, fx.net.dashboardResults_.size());

    // 90 s later (past the 60 s refresh window), peek STILL
    // returns the same counter, but the stopgap should force a
    // full round so server-computed urgency labels stay fresh.
    fx.clock.setMs(90'000);
    fx.queueFullRound();
    fx.s.tick();
    TEST_ASSERT_TRUE(fx.s.lastSyncOk());
    TEST_ASSERT_EQUAL_size_t(0, fx.net.dashboardResults_.size());
}

void test_sync_falls_through_to_full_round_when_peek_fails() {
    SyncFixture fx;
    fx.net.setOnline(true);
    fx.clock.setMs(1'000'000);
    fx.s.setIntervalMs(1);

    // First-boot full round to seed lastCounter_.
    fx.queueFullRound();
    fx.net.nextCounter_ = 5;
    fx.s.tick();

    // Next tick: peek fails (transient). SyncService must NOT
    // skip the round just because the peek didn't return — that
    // would silently freeze the device's view on a flapping
    // network. Fall through to a full round instead.
    fx.clock.setMs(1'030'000);
    fx.queueFullRound();
    fx.net.peekResults_.push_back(
        howler::application::NetResult::transient(0));
    fx.s.tick();
    TEST_ASSERT_TRUE(fx.s.lastSyncOk());
    TEST_ASSERT_EQUAL_size_t(0, fx.net.dashboardResults_.size());
}

void test_sync_persists_and_restores_counter() {
    // The wake-skip behaviour the user asked for: on reboot/wake,
    // peek the counter, and if it matches the NVS-cached value from
    // the previous session, skip the four fetches entirely. Without
    // NVS persistence the first post-boot tick paid a redundant full
    // round on every reboot.
    SyncFixture fx;
    fx.net.setOnline(true);
    fx.clock.setMs(1'000'000);
    fx.s.setIntervalMs(1);

    // Session 1: one full round anchors counter=99 in NVS.
    fx.queueFullRound();
    fx.net.nextCounter_ = 99;
    fx.s.tick();
    TEST_ASSERT_EQUAL_INT64(99, fx.s.lastCounter());
    // NVS now has a 9-byte blob at "howler.synccnt".
    TEST_ASSERT_TRUE(fx.storage.writes() >= 1);

    // Session 2 — simulate reboot/wake: fresh SyncService, same
    // storage. restoreFromStorage brings lastCounter_ to 99 AND
    // anchors lastFullRoundMs_ to "now" so the overdueFullRefresh
    // gate doesn't fire on first tick.
    SyncService s2(fx.net, fx.clock, fx.storage, fx.occ, fx.dash,
                   fx.allTasks, fx.users, fx.types, fx.wm, fx.hi, fx.di);
    s2.setIntervalMs(1);
    s2.restoreFromStorage();
    TEST_ASSERT_EQUAL_INT64(99, s2.lastCounter());

    // First tick on the rebooted service: peek returns 99 (same as
    // restored), so the four fetches are SKIPPED entirely. The
    // queueFullRound is NOT called below — if SyncService
    // incorrectly fetched anyway, the dashboard queue would be
    // empty and lastSyncOk would flip false.
    fx.clock.setMs(1'010'000);
    const size_t peekCallsBefore = fx.net.peekCalls_;
    s2.tick();
    TEST_ASSERT_TRUE(s2.lastSyncOk());
    TEST_ASSERT_EQUAL_INT64(99, s2.lastCounter());
    // Exactly one peek consumed for the gate check, no full-round
    // post-anchor peek (would have been a second call).
    TEST_ASSERT_EQUAL_size_t(peekCallsBefore + 1, fx.net.peekCalls_);
    TEST_ASSERT_EQUAL_size_t(0, fx.net.dashboardResults_.size());
}
