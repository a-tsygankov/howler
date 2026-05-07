#pragma once

#include <cstdint>
#include <string>

namespace howler::domain {

/// Mirrors the `task_results` row that the SPA renders in the result
/// picker (plan §11.3). On the dial we expose: the unit, the value
/// range, the step, and an optional default. `useLastValue` lets the
/// picker pre-seed with the user's last-entered value (looked up from
/// the last execution for that task).
struct ResultType {
    std::string id;
    std::string displayName;
    std::string unitName;
    bool        hasMin;
    bool        hasMax;
    bool        hasDefault;
    double      minValue;
    double      maxValue;
    double      step;
    double      defaultValue;
    bool        useLastValue;
    bool        system;
    int64_t     updatedAt;     // epoch seconds — sync watermark
};

/// Snap an arbitrary value onto the result type's grid (step + range).
/// Pure — used by tests and by the rotary picker.
inline double snapResultValue(const ResultType& rt, double value) {
    if (rt.hasMin && value < rt.minValue) value = rt.minValue;
    if (rt.hasMax && value > rt.maxValue) value = rt.maxValue;
    if (rt.step > 0) {
        const double base = rt.hasMin ? rt.minValue : 0.0;
        const double n = (value - base) / rt.step;
        // round half-away-from-zero (no <cmath> dependency in tests).
        const double rounded = (n >= 0)
            ? static_cast<double>(static_cast<long long>(n + 0.5))
            : static_cast<double>(static_cast<long long>(n - 0.5));
        value = base + rounded * rt.step;
    }
    if (rt.hasMin && value < rt.minValue) value = rt.minValue;
    if (rt.hasMax && value > rt.maxValue) value = rt.maxValue;
    return value;
}

}  // namespace howler::domain
