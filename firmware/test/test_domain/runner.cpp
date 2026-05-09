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

// test_drum_layout.cpp — pure aliasing-suppression rule
void test_drum_layout_n0_renders_nothing();
void test_drum_layout_n1_only_centre();
void test_drum_layout_n2_centre_and_one_neighbour();
void test_drum_layout_n3_centre_plus_two_neighbours();
void test_drum_layout_n4_still_suppresses_far_neighbours();
void test_drum_layout_n5_unlocks_tier_pm2();
void test_drum_layout_n7_unlocks_all_seven_tiers();
void test_drum_layout_respects_maxVisibleDistance_cap();

// test_urgency.cpp — port of backend/test/urgency.test.ts
void test_urgency_daily_urgent_in_last_quarter_of_gap();
void test_urgency_daily_non_urgent_in_second_to_last_quarter();
void test_urgency_daily_hidden_when_more_than_half_remains();
void test_urgency_daily_urgent_when_previous_slot_missed();
void test_urgency_daily_not_missed_when_modifiedAt_after_prev();
void test_urgency_daily_not_missed_when_executed_after_prev();
void test_urgency_daily_cycle_done_shifts_window_forward();
void test_urgency_periodic_hidden_early_in_cycle();
void test_urgency_periodic_non_urgent_in_second_to_last_quarter();
void test_urgency_periodic_urgent_in_last_quarter();
void test_urgency_periodic_urgent_and_missed_after_deadline();
void test_urgency_periodic_execution_reverses_missed();
void test_urgency_oneshot_hidden_when_far_away();
void test_urgency_oneshot_non_urgent_in_second_to_last_quarter();
void test_urgency_oneshot_urgent_in_last_quarter();
void test_urgency_oneshot_urgent_and_missed_past_deadline();
void test_urgency_oneshot_hidden_once_executed();
void test_urgency_oneshot_hidden_when_deadline_null();
void test_prev_deadline_daily_returns_latest_passed_today();
void test_prev_deadline_daily_returns_yesterday_when_no_today_yet();
void test_prev_deadline_periodic_returns_null_when_first_in_future();
void test_prev_deadline_periodic_returns_last_anchored();

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

    RUN_TEST(test_drum_layout_n0_renders_nothing);
    RUN_TEST(test_drum_layout_n1_only_centre);
    RUN_TEST(test_drum_layout_n2_centre_and_one_neighbour);
    RUN_TEST(test_drum_layout_n3_centre_plus_two_neighbours);
    RUN_TEST(test_drum_layout_n4_still_suppresses_far_neighbours);
    RUN_TEST(test_drum_layout_n5_unlocks_tier_pm2);
    RUN_TEST(test_drum_layout_n7_unlocks_all_seven_tiers);
    RUN_TEST(test_drum_layout_respects_maxVisibleDistance_cap);

    RUN_TEST(test_urgency_daily_urgent_in_last_quarter_of_gap);
    RUN_TEST(test_urgency_daily_non_urgent_in_second_to_last_quarter);
    RUN_TEST(test_urgency_daily_hidden_when_more_than_half_remains);
    RUN_TEST(test_urgency_daily_urgent_when_previous_slot_missed);
    RUN_TEST(test_urgency_daily_not_missed_when_modifiedAt_after_prev);
    RUN_TEST(test_urgency_daily_not_missed_when_executed_after_prev);
    RUN_TEST(test_urgency_daily_cycle_done_shifts_window_forward);
    RUN_TEST(test_urgency_periodic_hidden_early_in_cycle);
    RUN_TEST(test_urgency_periodic_non_urgent_in_second_to_last_quarter);
    RUN_TEST(test_urgency_periodic_urgent_in_last_quarter);
    RUN_TEST(test_urgency_periodic_urgent_and_missed_after_deadline);
    RUN_TEST(test_urgency_periodic_execution_reverses_missed);
    RUN_TEST(test_urgency_oneshot_hidden_when_far_away);
    RUN_TEST(test_urgency_oneshot_non_urgent_in_second_to_last_quarter);
    RUN_TEST(test_urgency_oneshot_urgent_in_last_quarter);
    RUN_TEST(test_urgency_oneshot_urgent_and_missed_past_deadline);
    RUN_TEST(test_urgency_oneshot_hidden_once_executed);
    RUN_TEST(test_urgency_oneshot_hidden_when_deadline_null);
    RUN_TEST(test_prev_deadline_daily_returns_latest_passed_today);
    RUN_TEST(test_prev_deadline_daily_returns_yesterday_when_no_today_yet);
    RUN_TEST(test_prev_deadline_periodic_returns_null_when_first_in_future);
    RUN_TEST(test_prev_deadline_periodic_returns_last_anchored);

    return UNITY_END();
}
