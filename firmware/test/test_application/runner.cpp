#include <unity.h>

// test_sync_service.cpp
void test_sync_no_op_when_offline();
void test_sync_replaces_dashboard_users_result_types();
void test_sync_respects_interval();

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

// test_app.cpp
void test_app_first_boot_lands_on_pair_screen();
void test_app_paired_token_lands_on_dashboard();
void test_app_pair_confirm_swaps_to_dashboard();
void test_app_commit_pending_done_drops_dashboard_row();
void test_app_wifi_scan_populates_list();
void test_app_wifi_save_persists_and_connects();

extern "C" void setUp(void) {}
extern "C" void tearDown(void) {}

int main(int, char**) {
    UNITY_BEGIN();

    RUN_TEST(test_sync_no_op_when_offline);
    RUN_TEST(test_sync_replaces_dashboard_users_result_types);
    RUN_TEST(test_sync_respects_interval);

    RUN_TEST(test_mark_done_enqueue_persists_and_drains_when_online);
    RUN_TEST(test_mark_done_offline_no_send_persists_only);
    RUN_TEST(test_mark_done_drops_on_permanent_error);
    RUN_TEST(test_mark_done_keeps_on_transient_error);
    RUN_TEST(test_mark_done_serializes_round_trip);

    RUN_TEST(test_pair_start_populates_code_and_expiry);
    RUN_TEST(test_pair_check_confirmed_persists_token);
    RUN_TEST(test_pair_isPaired_reads_storage);
    RUN_TEST(test_pair_check_throttles_calls);

    RUN_TEST(test_app_first_boot_lands_on_pair_screen);
    RUN_TEST(test_app_paired_token_lands_on_dashboard);
    RUN_TEST(test_app_pair_confirm_swaps_to_dashboard);
    RUN_TEST(test_app_commit_pending_done_drops_dashboard_row);
    RUN_TEST(test_app_wifi_scan_populates_list);
    RUN_TEST(test_app_wifi_save_persists_and_connects);

    return UNITY_END();
}
