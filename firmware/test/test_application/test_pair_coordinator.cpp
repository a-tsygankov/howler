#include <unity.h>

#include "../../src/application/PairCoordinator.h"
#include "stubs.h"

using howler::application::PairCoordinator;
using howler::domain::PairPhase;
using howler::testing::StubClock;
using howler::testing::StubPairApi;
using howler::testing::StubStorage;

void test_pair_start_populates_code_and_expiry() {
    StubClock clock;
    StubPairApi api;
    StubStorage storage;
    api.startCode_ = "654321";
    api.startExpires_ = 12345;

    PairCoordinator c(api, storage, clock);
    c.start("dev-1");
    TEST_ASSERT_EQUAL(static_cast<int>(PairPhase::Started),
                      static_cast<int>(c.state().phase));
    TEST_ASSERT_EQUAL_STRING("654321", c.state().pairCode.c_str());
    TEST_ASSERT_EQUAL_INT64(12345, c.state().expiresAt);
}

void test_pair_check_confirmed_persists_token() {
    StubClock clock;
    StubPairApi api;
    StubStorage storage;
    api.startCode_ = "111111";
    api.checkPhase_ = PairPhase::Confirmed;
    api.checkToken_ = "the-token";

    PairCoordinator c(api, storage, clock);
    c.start("dev-1");
    clock.advance(10'000);
    c.tick();
    TEST_ASSERT_EQUAL(static_cast<int>(PairPhase::Confirmed),
                      static_cast<int>(c.state().phase));
    std::string tok;
    TEST_ASSERT_TRUE(storage.readBlob(PairCoordinator::kTokenKey, tok));
    TEST_ASSERT_EQUAL_STRING("the-token", tok.c_str());
}

void test_pair_isPaired_reads_storage() {
    StubStorage storage;
    TEST_ASSERT_FALSE(PairCoordinator::isPaired(storage));
    storage.writeBlob(PairCoordinator::kTokenKey, "tok");
    TEST_ASSERT_TRUE(PairCoordinator::isPaired(storage));
    PairCoordinator::clearToken(storage);
    TEST_ASSERT_FALSE(PairCoordinator::isPaired(storage));
}

void test_pair_check_throttles_calls() {
    StubClock clock;
    StubPairApi api;
    StubStorage storage;
    api.startCode_ = "111111";
    api.checkPhase_ = PairPhase::Pending;

    PairCoordinator c(api, storage, clock);
    c.start("dev-1");
    // Without time advance, the next tick must not poll (poll cooldown)
    clock.advance(500);
    c.tick();
    TEST_ASSERT_EQUAL(static_cast<int>(PairPhase::Started),
                      static_cast<int>(c.state().phase));
    // 3 s elapsed → poll runs; phase moves to Pending.
    clock.advance(3'000);
    c.tick();
    TEST_ASSERT_EQUAL(static_cast<int>(PairPhase::Pending),
                      static_cast<int>(c.state().phase));
}
