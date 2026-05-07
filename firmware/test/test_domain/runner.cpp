// Single Unity entry point for the test_domain runner. Each
// individual test file declares functions with `void test_*()`
// signatures; we pull them in here via forward declarations so a
// missing test triggers a link error rather than silently going
// uncalled.

#include <unity.h>

// test_occurrence_list.cpp
void test_higher_priority_comes_first();
void test_equal_priority_breaks_on_due_at();
void test_negative_due_is_least_urgent_within_priority();

// test_dashboard_model.cpp
void test_dashboard_urgent_first_then_due();
void test_dashboard_negative_due_sorts_last_within_tier();
void test_dashboard_cursor_wraps();
void test_dashboard_replace_preserves_cursor_by_id();
void test_dashboard_remove_by_id_keeps_cursor_valid();
void test_dashboard_first_non_urgent_marker();

// test_mark_done_queue.cpp
void test_queue_fifo_order();
void test_queue_drops_oldest_at_cap();
void test_queue_drop_by_execution_id();

// test_router.cpp
void test_router_starts_at_boot_root();
void test_router_push_pop_back_to_root();
void test_router_replace_clears_stack();

// test_rotary_nav.cpp
void test_rotary_wraps();
void test_rotary_clamped_does_not_wrap();
void test_rotary_handles_zero_size();
void test_rotary_setSize_clamps_cursor();

// test_result_type.cpp
void test_snap_clamps_to_range();
void test_snap_aligns_to_step();
void test_snap_with_offset_min();

// test_result_edit_model.cpp
void test_result_edit_seeds_from_last_when_useLastValue_true();
void test_result_edit_falls_through_to_default_when_no_last();
void test_result_edit_falls_through_to_min_when_no_default();
void test_result_edit_useLast_false_ignores_lastValue();
void test_result_edit_nudge_clamps_to_range();
void test_result_edit_nudge_aligns_to_step();
void test_result_edit_format_decimals_from_step();
void test_result_edit_commit_marks();

// test_round_menu_model.cpp
void test_round_menu_replace_resets_cursor_when_oob();
void test_round_menu_replace_preserving_cursor_keeps_id();
void test_round_menu_move_cursor_wraps();
void test_round_menu_remove_by_id_keeps_cursor_valid();
void test_round_menu_empty_handles_gracefully();

// test_long_press_arc.cpp
void test_arc_idle_when_not_held();
void test_arc_charges_then_fires();
void test_arc_releases_before_threshold_resets();

extern "C" void setUp(void) {}
extern "C" void tearDown(void) {}

int main(int, char**) {
    UNITY_BEGIN();

    RUN_TEST(test_higher_priority_comes_first);
    RUN_TEST(test_equal_priority_breaks_on_due_at);
    RUN_TEST(test_negative_due_is_least_urgent_within_priority);

    RUN_TEST(test_dashboard_urgent_first_then_due);
    RUN_TEST(test_dashboard_negative_due_sorts_last_within_tier);
    RUN_TEST(test_dashboard_cursor_wraps);
    RUN_TEST(test_dashboard_replace_preserves_cursor_by_id);
    RUN_TEST(test_dashboard_remove_by_id_keeps_cursor_valid);
    RUN_TEST(test_dashboard_first_non_urgent_marker);

    RUN_TEST(test_queue_fifo_order);
    RUN_TEST(test_queue_drops_oldest_at_cap);
    RUN_TEST(test_queue_drop_by_execution_id);

    RUN_TEST(test_router_starts_at_boot_root);
    RUN_TEST(test_router_push_pop_back_to_root);
    RUN_TEST(test_router_replace_clears_stack);

    RUN_TEST(test_rotary_wraps);
    RUN_TEST(test_rotary_clamped_does_not_wrap);
    RUN_TEST(test_rotary_handles_zero_size);
    RUN_TEST(test_rotary_setSize_clamps_cursor);

    RUN_TEST(test_snap_clamps_to_range);
    RUN_TEST(test_snap_aligns_to_step);
    RUN_TEST(test_snap_with_offset_min);

    RUN_TEST(test_result_edit_seeds_from_last_when_useLastValue_true);
    RUN_TEST(test_result_edit_falls_through_to_default_when_no_last);
    RUN_TEST(test_result_edit_falls_through_to_min_when_no_default);
    RUN_TEST(test_result_edit_useLast_false_ignores_lastValue);
    RUN_TEST(test_result_edit_nudge_clamps_to_range);
    RUN_TEST(test_result_edit_nudge_aligns_to_step);
    RUN_TEST(test_result_edit_format_decimals_from_step);
    RUN_TEST(test_result_edit_commit_marks);

    RUN_TEST(test_round_menu_replace_resets_cursor_when_oob);
    RUN_TEST(test_round_menu_replace_preserving_cursor_keeps_id);
    RUN_TEST(test_round_menu_move_cursor_wraps);
    RUN_TEST(test_round_menu_remove_by_id_keeps_cursor_valid);
    RUN_TEST(test_round_menu_empty_handles_gracefully);

    RUN_TEST(test_arc_idle_when_not_held);
    RUN_TEST(test_arc_charges_then_fires);
    RUN_TEST(test_arc_releases_before_threshold_resets);

    return UNITY_END();
}
