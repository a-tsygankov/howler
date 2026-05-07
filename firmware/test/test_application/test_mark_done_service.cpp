#include <unity.h>

#include "../../src/application/MarkDoneService.h"
#include "stubs.h"

using howler::application::MarkDoneService;
using howler::application::NetResult;
using howler::domain::MarkDoneQueue;
using howler::domain::TaskId;
using howler::testing::StubClock;
using howler::testing::StubNetwork;
using howler::testing::StubRandom;
using howler::testing::StubStorage;

void test_mark_done_enqueue_persists_and_drains_when_online() {
    StubClock clock; clock.setMs(1'000'000);
    StubRandom rng;
    StubStorage storage;
    StubNetwork net;
    net.setOnline(true);
    net.markDoneResults_ = { NetResult::ok() };

    MarkDoneQueue q;
    MarkDoneService s(net, clock, rng, storage, q);
    s.enqueue(TaskId("t1"), "occ1", "u1", true, 12.5);

    TEST_ASSERT_EQUAL_size_t(1, q.size());
    TEST_ASSERT_EQUAL_size_t(1, storage.writes());

    // First tick: send. Then the queue drains.
    clock.advance(10'000);
    s.tick();
    TEST_ASSERT_EQUAL_size_t(0, q.size());
    TEST_ASSERT_EQUAL_size_t(1, net.sentDrafts_.size());
    TEST_ASSERT_EQUAL_STRING("occ1", net.sentDrafts_[0].occurrenceId.c_str());
    TEST_ASSERT_TRUE(net.sentDrafts_[0].hasResultValue);
}

void test_mark_done_offline_no_send_persists_only() {
    StubClock clock;
    StubRandom rng;
    StubStorage storage;
    StubNetwork net;
    net.setOnline(false);

    MarkDoneQueue q;
    MarkDoneService s(net, clock, rng, storage, q);
    s.enqueue(TaskId("t1"), "", "", false, 0);
    TEST_ASSERT_EQUAL_size_t(1, q.size());
    s.tick();  // offline → no-op
    TEST_ASSERT_EQUAL_size_t(1, q.size());
    TEST_ASSERT_EQUAL_size_t(0, net.sentDrafts_.size());
}

void test_mark_done_drops_on_permanent_error() {
    StubClock clock; clock.setMs(1'000'000);
    StubRandom rng;
    StubStorage storage;
    StubNetwork net;
    net.setOnline(true);
    net.markDoneResults_ = { NetResult::permanent(400, "bad") };

    MarkDoneQueue q;
    MarkDoneService s(net, clock, rng, storage, q);
    s.enqueue(TaskId("t1"), "", "", false, 0);

    clock.advance(10'000);
    s.tick();
    // Permanent error → drop the head so we don't loop.
    TEST_ASSERT_EQUAL_size_t(0, q.size());
}

void test_mark_done_keeps_on_transient_error() {
    StubClock clock; clock.setMs(1'000'000);
    StubRandom rng;
    StubStorage storage;
    StubNetwork net;
    net.setOnline(true);
    net.markDoneResults_ = {
        NetResult::transient(503),
        NetResult::ok(),
    };

    MarkDoneQueue q;
    MarkDoneService s(net, clock, rng, storage, q);
    s.enqueue(TaskId("t1"), "", "", false, 0);

    clock.advance(10'000);
    s.tick();
    TEST_ASSERT_EQUAL_size_t(1, q.size());  // still pending
    clock.advance(10'000);  // past the backoff
    s.tick();
    TEST_ASSERT_EQUAL_size_t(0, q.size());
}

void test_mark_done_serializes_round_trip() {
    MarkDoneQueue q;
    howler::domain::MarkDoneDraft d;
    d.executionId = "exec-1";
    d.taskId = TaskId("task-aabb");
    d.occurrenceId = "occ-1";
    d.userId = "user-1";
    d.hasResultValue = true;
    d.resultValue = 7.25;
    d.notes = "";
    d.ts = 1700000123;
    d.attempts = 4;
    q.enqueue(d);

    const auto bytes = MarkDoneService::serialize(q);
    MarkDoneQueue q2;
    TEST_ASSERT_TRUE(MarkDoneService::deserialize(bytes, q2));
    TEST_ASSERT_EQUAL_size_t(1, q2.size());
    const auto& got = q2.items()[0];
    TEST_ASSERT_EQUAL_STRING("exec-1", got.executionId.c_str());
    TEST_ASSERT_EQUAL_STRING("task-aabb", got.taskId.hex().c_str());
    TEST_ASSERT_EQUAL_STRING("occ-1", got.occurrenceId.c_str());
    TEST_ASSERT_EQUAL_STRING("user-1", got.userId.c_str());
    TEST_ASSERT_TRUE(got.hasResultValue);
    TEST_ASSERT_EQUAL_DOUBLE(7.25, got.resultValue);
    TEST_ASSERT_EQUAL_INT64(1700000123, got.ts);
    TEST_ASSERT_EQUAL_UINT16(4, got.attempts);
}
