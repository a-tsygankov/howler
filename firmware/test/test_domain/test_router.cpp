#include <unity.h>

#include "../../src/domain/Router.h"

using howler::domain::Router;
using howler::domain::ScreenId;

void test_router_starts_at_boot_root() {
    Router r;
    TEST_ASSERT_EQUAL(static_cast<int>(ScreenId::Boot), static_cast<int>(r.current()));
    TEST_ASSERT_TRUE(r.atRoot());
    TEST_ASSERT_FALSE(r.pop());  // can't pop the root
}

void test_router_push_pop_back_to_root() {
    Router r;
    r.push(ScreenId::Dashboard);
    r.push(ScreenId::Settings);
    TEST_ASSERT_EQUAL(static_cast<int>(ScreenId::Settings), static_cast<int>(r.current()));
    TEST_ASSERT_FALSE(r.atRoot());
    TEST_ASSERT_TRUE(r.pop());
    TEST_ASSERT_EQUAL(static_cast<int>(ScreenId::Dashboard), static_cast<int>(r.current()));
    TEST_ASSERT_TRUE(r.pop());
    TEST_ASSERT_TRUE(r.atRoot());
}

void test_router_replace_clears_stack() {
    Router r;
    r.push(ScreenId::Pair);
    r.push(ScreenId::Settings);
    TEST_ASSERT_EQUAL_size_t(3, r.depth());
    r.replaceRoot(ScreenId::Dashboard);
    TEST_ASSERT_EQUAL_size_t(1, r.depth());
    TEST_ASSERT_EQUAL(static_cast<int>(ScreenId::Dashboard), static_cast<int>(r.current()));
}
