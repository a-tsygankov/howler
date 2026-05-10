#include <unity.h>

// test_sync_service.cpp
void test_sync_no_op_when_offline();
void test_sync_replaces_dashboard_users_result_types();
void test_sync_respects_interval();
void test_sync_skips_fetches_when_peek_counter_unchanged();
void test_sync_full_round_when_peek_counter_advances();
void test_sync_full_refresh_after_5min_even_when_counter_unchanged();
void test_sync_falls_through_to_full_round_when_peek_fails();

// test_mark_done_service.cpp
void test_mark_done_enqueue_persists_and_drains_when_online();
void test_mark_done_offline_no_send_persists_only();
void test_mark_done_drops_on_permanent_error();
void test_mark_done_keeps_on_transient_error();
void test_mark_done_serializes_round_trip();

// test_pair_coordinator.cpp
void test_pair_start_populates_code_and_expiry();
void test_pair_check_confirmed_persists_token();
void test_pair_isPaired_reads_storage();
void test_pair_check_throttles_calls();
void test_pair_retries_start_after_failure();

// test_app.cpp
void test_app_first_boot_lands_on_pair_screen();
void test_app_paired_token_lands_on_dashboard();
void test_app_pair_confirm_swaps_to_dashboard();
void test_app_commit_pending_done_drops_dashboard_row();
void test_app_wifi_scan_populates_list();
void test_app_wifi_save_persists_and_connects();

// test_ota_service.cpp — F4 self-update state machine
void test_ota_idle_until_check_requested();
void test_ota_check_no_update_lands_in_uptodate();
void test_ota_check_advisory_lands_in_update_available();
void test_ota_check_rejects_downlevel_advisory_locally();
void test_ota_check_offline_lands_in_failed_with_offline_message();
void test_ota_check_transient_error_is_retryable();
void test_ota_apply_succeeds_lands_flashed_then_reboots();
void test_ota_apply_failure_lands_failed_with_mapped_message();
void test_ota_apply_ignored_when_not_in_update_available_state();
void test_ota_pending_verify_forwards_to_adapter();
void test_ota_reset_clears_state_and_advisory();

extern "C" void setUp(void) {}
extern "C" void tearDown(void) {}

int main(int, char**) {
    UNITY_BEGIN();

    RUN_TEST(test_sync_no_op_when_offline);
    RUN_TEST(test_sync_replaces_dashboard_users_result_types);
    RUN_TEST(test_sync_respects_interval);
    RUN_TEST(test_sync_skips_fetches_when_peek_counter_unchanged);
    RUN_TEST(test_sync_full_round_when_peek_counter_advances);
    RUN_TEST(test_sync_full_refresh_after_5min_even_when_counter_unchanged);
    RUN_TEST(test_sync_falls_through_to_full_round_when_peek_fails);

    RUN_TEST(test_mark_done_enqueue_persists_and_drains_when_online);
    RUN_TEST(test_mark_done_offline_no_send_persists_only);
    RUN_TEST(test_mark_done_drops_on_permanent_error);
    RUN_TEST(test_mark_done_keeps_on_transient_error);
    RUN_TEST(test_mark_done_serializes_round_trip);

    RUN_TEST(test_pair_start_populates_code_and_expiry);
    RUN_TEST(test_pair_check_confirmed_persists_token);
    RUN_TEST(test_pair_isPaired_reads_storage);
    RUN_TEST(test_pair_check_throttles_calls);
    RUN_TEST(test_pair_retries_start_after_failure);

    RUN_TEST(test_app_first_boot_lands_on_pair_screen);
    RUN_TEST(test_app_paired_token_lands_on_dashboard);
    RUN_TEST(test_app_pair_confirm_swaps_to_dashboard);
    RUN_TEST(test_app_commit_pending_done_drops_dashboard_row);
    RUN_TEST(test_app_wifi_scan_populates_list);
    RUN_TEST(test_app_wifi_save_persists_and_connects);

    RUN_TEST(test_ota_idle_until_check_requested);
    RUN_TEST(test_ota_check_no_update_lands_in_uptodate);
    RUN_TEST(test_ota_check_advisory_lands_in_update_available);
    RUN_TEST(test_ota_check_rejects_downlevel_advisory_locally);
    RUN_TEST(test_ota_check_offline_lands_in_failed_with_offline_message);
    RUN_TEST(test_ota_check_transient_error_is_retryable);
    RUN_TEST(test_ota_apply_succeeds_lands_flashed_then_reboots);
    RUN_TEST(test_ota_apply_failure_lands_failed_with_mapped_message);
    RUN_TEST(test_ota_apply_ignored_when_not_in_update_available_state);
    RUN_TEST(test_ota_pending_verify_forwards_to_adapter);
    RUN_TEST(test_ota_reset_clears_state_and_advisory);

    return UNITY_END();
}
