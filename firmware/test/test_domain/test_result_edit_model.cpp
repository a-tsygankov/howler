#include <unity.h>

#include "../../src/domain/ResultEditModel.h"

using howler::domain::ResultEditModel;
using howler::domain::ResultType;

namespace {

ResultType make(double min, double max, double step,
                bool useLast = true, bool hasDefault = false,
                double defaultVal = 0.0) {
    ResultType rt{};
    rt.id = "rt-1";
    rt.unitName = "g";
    rt.hasMin = true; rt.hasMax = true;
    rt.minValue = min; rt.maxValue = max;
    rt.step = step;
    rt.useLastValue = useLast;
    rt.hasDefault = hasDefault;
    rt.defaultValue = defaultVal;
    return rt;
}

}  // namespace

void test_result_edit_seeds_from_last_when_useLastValue_true() {
    ResultEditModel m;
    m.reset(make(0, 100, 1, /*useLast=*/true), 42.7, /*hasLast=*/true);
    // Last gets snapped to nearest step.
    TEST_ASSERT_EQUAL_DOUBLE(43.0, m.value());
    TEST_ASSERT_TRUE(m.hasLast());
}

void test_result_edit_falls_through_to_default_when_no_last() {
    ResultEditModel m;
    m.reset(make(0, 100, 1, true, /*hasDef=*/true, 50), 0, /*hasLast=*/false);
    TEST_ASSERT_EQUAL_DOUBLE(50.0, m.value());
}

void test_result_edit_falls_through_to_min_when_no_default() {
    ResultEditModel m;
    m.reset(make(5, 100, 1), 0, /*hasLast=*/false);
    TEST_ASSERT_EQUAL_DOUBLE(5.0, m.value());
}

void test_result_edit_useLast_false_ignores_lastValue() {
    ResultEditModel m;
    m.reset(make(0, 100, 1, /*useLast=*/false, /*hasDef=*/true, 25), 99, /*hasLast=*/true);
    TEST_ASSERT_EQUAL_DOUBLE(25.0, m.value());
}

void test_result_edit_nudge_clamps_to_range() {
    ResultEditModel m;
    m.reset(make(0, 10, 1), 5, true);
    m.nudge(20);   // would go to 25; clamps to 10
    TEST_ASSERT_EQUAL_DOUBLE(10.0, m.value());
    m.nudge(-100); // clamps to 0
    TEST_ASSERT_EQUAL_DOUBLE(0.0, m.value());
}

void test_result_edit_nudge_aligns_to_step() {
    ResultEditModel m;
    m.reset(make(0, 10, 0.5), 0, false);
    m.nudge(3);  // 0 + 3*0.5 = 1.5
    TEST_ASSERT_EQUAL_DOUBLE(1.5, m.value());
}

void test_result_edit_format_decimals_from_step() {
    ResultEditModel m;
    m.reset(make(0, 100, 1), 7, true);
    TEST_ASSERT_EQUAL_INT(0, m.decimals());
    TEST_ASSERT_EQUAL_STRING("7", m.formatValue().c_str());

    m.reset(make(0, 10, 0.5), 1.5, true);
    TEST_ASSERT_EQUAL_INT(1, m.decimals());
    TEST_ASSERT_EQUAL_STRING("1.5", m.formatValue().c_str());

    m.reset(make(0, 1, 0.05), 0.25, true);
    TEST_ASSERT_EQUAL_INT(2, m.decimals());
    TEST_ASSERT_EQUAL_STRING("0.25", m.formatValue().c_str());
}

void test_result_edit_commit_marks() {
    ResultEditModel m;
    m.reset(make(0, 10, 1), 5, true);
    TEST_ASSERT_FALSE(m.committed());
    m.commit();
    TEST_ASSERT_TRUE(m.committed());
}
