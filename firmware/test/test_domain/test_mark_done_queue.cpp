#include <unity.h>

#include "../../src/domain/MarkDoneQueue.h"

using howler::domain::MarkDoneDraft;
using howler::domain::MarkDoneQueue;
using howler::domain::TaskId;

namespace {

MarkDoneDraft makeDraft(const char* execId, const char* taskHex) {
    MarkDoneDraft d;
    d.executionId = execId;
    d.taskId = TaskId(taskHex);
    d.occurrenceId = "";
    d.userId = "";
    d.hasResultValue = false;
    d.resultValue = 0.0;
    d.ts = 100;
    d.attempts = 0;
    return d;
}

}  // namespace

void test_queue_fifo_order() {
    MarkDoneQueue q;
    q.enqueue(makeDraft("e1", "t1"));
    q.enqueue(makeDraft("e2", "t2"));
    q.enqueue(makeDraft("e3", "t3"));
    TEST_ASSERT_EQUAL_size_t(3, q.size());
    TEST_ASSERT_EQUAL_STRING("e1", q.front()->executionId.c_str());
    q.popFront();
    TEST_ASSERT_EQUAL_STRING("e2", q.front()->executionId.c_str());
}

void test_queue_drops_oldest_at_cap() {
    MarkDoneQueue q;
    char id[8];
    for (int i = 0; i < 40; ++i) {
        snprintf(id, sizeof(id), "e%03d", i);
        q.enqueue(makeDraft(id, "t"));
    }
    TEST_ASSERT_EQUAL_size_t(MarkDoneQueue::kMaxSize, q.size());
    // The oldest entries (0..7) should be dropped.
    TEST_ASSERT_EQUAL_STRING("e008", q.front()->executionId.c_str());
}

void test_queue_drop_by_execution_id() {
    MarkDoneQueue q;
    q.enqueue(makeDraft("a", "t1"));
    q.enqueue(makeDraft("b", "t2"));
    q.enqueue(makeDraft("c", "t3"));
    q.dropByExecutionId("b");
    TEST_ASSERT_EQUAL_size_t(2, q.size());
    TEST_ASSERT_EQUAL_STRING("a", q.items()[0].executionId.c_str());
    TEST_ASSERT_EQUAL_STRING("c", q.items()[1].executionId.c_str());
}
