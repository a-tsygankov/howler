#pragma once

#include "ResultType.h"

#include <cstdint>
#include <cmath>
#include <string>

namespace howler::domain {

/// In-progress result-value editor. Pure value type — UI components
/// snapshot these to render and feed back the user's rotation/tap
/// events as state mutations. No LVGL, no Arduino — host-testable.
///
/// The model holds a single `value` constrained by the result type's
/// `min`/`max`/`step`. Rotation events nudge the value by one step;
/// the UI shows the value, the unit name, and (when applicable) the
/// previous value as a "last time" hint so the user can adjust
/// rather than re-enter from scratch.
///
/// Initial value priority:
///   1. lastValue (from previous task_executions row, if any)
///   2. type.defaultValue (if set)
///   3. type.minValue (if hasMin)
///   4. 0
///
/// `committed` flips true when the user finishes the picker (long-press
/// confirm); the upstream flow then pulls `value()` and persists.
class ResultEditModel {
public:
    ResultEditModel() = default;

    void reset(const ResultType& type, double lastValue, bool hasLast) {
        type_ = type;
        if (hasLast) {
            value_ = type.useLastValue ? lastValue : pickInitialIgnoringLast();
        } else {
            value_ = pickInitialIgnoringLast();
        }
        value_ = snap(value_);
        hasLast_ = hasLast;
        lastValue_ = hasLast ? snap(lastValue) : value_;
        committed_ = false;
    }

    const ResultType& type() const { return type_; }
    double value() const { return value_; }
    double lastValue() const { return lastValue_; }
    bool hasLast() const { return hasLast_; }
    bool committed() const { return committed_; }

    /// Step the value up (delta=+1) / down (delta=-1) one snap unit.
    /// Multi-step deltas (e.g., fast knob spin) accumulate naturally.
    void nudge(int delta) {
        if (type_.step <= 0 || delta == 0) return;
        const double next = value_ + delta * type_.step;
        value_ = snap(next);
    }

    void commit() { committed_ = true; }

    /// Format `value` for display. Picks decimal places from `step`:
    /// integer step → no decimals; 0.1 step → one decimal; 0.01 → two.
    /// Capped at 2 decimals — beyond that the UI is unreadable on the
    /// 240×240 round display anyway.
    std::string formatValue() const {
        return formatFor(value_);
    }

    std::string formatLast() const {
        return formatFor(lastValue_);
    }

    /// Decimals derived from step.
    int decimals() const {
        if (type_.step >= 1.0 - 1e-9) return 0;
        if (type_.step >= 0.1 - 1e-9) return 1;
        return 2;
    }

private:
    ResultType type_{};
    double     value_     = 0.0;
    double     lastValue_ = 0.0;
    bool       hasLast_   = false;
    bool       committed_ = false;

    double pickInitialIgnoringLast() const {
        if (type_.hasDefault) return type_.defaultValue;
        if (type_.hasMin)     return type_.minValue;
        return 0.0;
    }

    double snap(double v) const {
        return snapResultValue(type_, v);
    }

    std::string formatFor(double v) const {
        char buf[32];
        const int d = decimals();
        if (d == 0) {
            snprintf(buf, sizeof(buf), "%lld",
                static_cast<long long>(v >= 0 ? v + 0.5 : v - 0.5));
        } else {
            snprintf(buf, sizeof(buf), d == 1 ? "%.1f" : "%.2f", v);
        }
        return buf;
    }
};

}  // namespace howler::domain
