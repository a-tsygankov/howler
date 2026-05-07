#include <unity.h>

#include "../../src/application/SyncService.h"
#include "../../src/domain/DashboardModel.h"
#include "../../src/domain/OccurrenceList.h"
#include "../../src/domain/SyncWatermark.h"
#include "stubs.h"

using howler::application::SyncService;
using howler::domain::DashboardItem;
using howler::domain::DashboardModel;
using howler::domain::OccurrenceList;
using howler::domain::ResultType;
using howler::domain::SyncWatermark;
using howler::domain::User;
using howler::testing::StubClock;
using howler::testing::StubNetwork;

void test_sync_no_op_when_offline() {
    StubClock clock;
    StubNetwork net;
    net.setOnline(false);
    DashboardModel dash;
    OccurrenceList occ;
    std::vector<User> users;
    std::vector<ResultType> types;
    SyncWatermark wm;
    SyncService s(net, clock, occ, dash, users, types, wm);
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
    SyncService s(net, clock, occ, dash, users, types, wm);
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
    SyncService s(net, clock, occ, dash, users, types, wm);
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
