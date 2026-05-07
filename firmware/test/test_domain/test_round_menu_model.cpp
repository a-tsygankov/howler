#include <unity.h>

#include "../../src/domain/RoundMenuModel.h"

using howler::domain::RoundMenuItem;
using howler::domain::RoundMenuModel;

namespace {

RoundMenuItem mk(const char* id, const char* title) {
    RoundMenuItem it;
    it.id = id;
    it.title = title;
    return it;
}

}  // namespace

void test_round_menu_replace_resets_cursor_when_oob() {
    RoundMenuModel m;
    m.replace({mk("a", "A"), mk("b", "B"), mk("c", "C")});
    m.setCursor(2);
    TEST_ASSERT_EQUAL_size_t(2, m.cursor());
    m.replace({mk("x", "X")});
    TEST_ASSERT_EQUAL_size_t(0, m.cursor());
}

void test_round_menu_replace_preserving_cursor_keeps_id() {
    RoundMenuModel m;
    m.replace({mk("a", "A"), mk("b", "B"), mk("c", "C")});
    m.setCursor(1);  // points at "b"
    m.replacePreservingCursor({mk("c", "C"), mk("b", "B"), mk("a", "A")});
    TEST_ASSERT_EQUAL_STRING("b", m.selected()->id.c_str());
}

void test_round_menu_move_cursor_wraps() {
    RoundMenuModel m;
    m.replace({mk("a", "A"), mk("b", "B"), mk("c", "C")});
    m.moveCursor(4);  // 0 + 4 = 4 mod 3 = 1
    TEST_ASSERT_EQUAL_size_t(1, m.cursor());
    m.moveCursor(-3);  // wraps back
    TEST_ASSERT_EQUAL_size_t(1, m.cursor());
    m.moveCursor(-1);  // wraps to 0
    TEST_ASSERT_EQUAL_size_t(0, m.cursor());
}

void test_round_menu_remove_by_id_keeps_cursor_valid() {
    RoundMenuModel m;
    m.replace({mk("a", "A"), mk("b", "B"), mk("c", "C")});
    m.setCursor(2);
    m.removeById("b");
    // cursor was 2, item at index 1 went away, so cursor decremented to 1
    TEST_ASSERT_EQUAL_size_t(1, m.cursor());
    TEST_ASSERT_EQUAL_STRING("c", m.selected()->id.c_str());
}

void test_round_menu_empty_handles_gracefully() {
    RoundMenuModel m;
    TEST_ASSERT_TRUE(m.empty());
    TEST_ASSERT_NULL(m.selected());
    m.moveCursor(5);   // no-op
    TEST_ASSERT_EQUAL_size_t(0, m.cursor());
}
