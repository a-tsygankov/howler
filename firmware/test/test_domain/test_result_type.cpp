#include <unity.h>

#include "../../src/domain/ResultType.h"

using howler::domain::ResultType;
using howler::domain::snapResultValue;

namespace {

ResultType make(double min, double max, double step) {
    ResultType rt{};
    rt.hasMin = true;
    rt.hasMax = true;
    rt.minValue = min;
    rt.maxValue = max;
    rt.step = step;
    return rt;
}

}  // namespace

void test_snap_clamps_to_range() {
    auto rt = make(0, 100, 1);
    TEST_ASSERT_EQUAL_DOUBLE(0.0, snapResultValue(rt, -10.0));
    TEST_ASSERT_EQUAL_DOUBLE(100.0, snapResultValue(rt, 1000.0));
}

void test_snap_aligns_to_step() {
    auto rt = make(0, 10, 0.5);
    TEST_ASSERT_EQUAL_DOUBLE(2.0, snapResultValue(rt, 1.9));
    TEST_ASSERT_EQUAL_DOUBLE(2.5, snapResultValue(rt, 2.3));
    TEST_ASSERT_EQUAL_DOUBLE(0.0, snapResultValue(rt, 0.1));
}

void test_snap_with_offset_min() {
    auto rt = make(5, 25, 5);
    TEST_ASSERT_EQUAL_DOUBLE(10.0, snapResultValue(rt, 8.0));
    TEST_ASSERT_EQUAL_DOUBLE(25.0, snapResultValue(rt, 30.0));
    TEST_ASSERT_EQUAL_DOUBLE(5.0, snapResultValue(rt, 5.0));
}
