#pragma once

#include <cstddef>
#include <cstdint>

namespace howler::domain {

/// Wraps a list cursor. The encoder driver feeds raw deltas (CW = +1,
/// CCW = -1) and a press/long-press event; this class translates into
/// "cursor changed" / "selected" / "back" calls. Wrap-around is on
/// for cycle-style navigation (dashboard, picker), off for editor-
/// style numeric selection (use clampingCursor() in those cases).
class RotaryNav {
public:
    enum class Action : uint8_t { None, CursorChanged, Selected, Back };

    explicit RotaryNav(size_t size = 0) : size_(size) {}

    void setSize(size_t n) {
        size_ = n;
        if (cursor_ >= size_) cursor_ = (size_ == 0) ? 0 : size_ - 1;
    }

    size_t size() const { return size_; }
    size_t cursor() const { return cursor_; }
    void setCursor(size_t c) { cursor_ = (size_ == 0) ? 0 : (c % size_); }

    /// Wrap-around step.
    Action onRotate(int delta) {
        if (size_ == 0 || delta == 0) return Action::None;
        const long n = static_cast<long>(size_);
        long c = static_cast<long>(cursor_) + delta;
        c = ((c % n) + n) % n;
        cursor_ = static_cast<size_t>(c);
        return Action::CursorChanged;
    }

    /// Clamping step — for numeric editors where wrapping would be
    /// surprising (e.g. brightness slider).
    Action onRotateClamped(int delta) {
        if (size_ == 0 || delta == 0) return Action::None;
        long c = static_cast<long>(cursor_) + delta;
        if (c < 0) c = 0;
        if (c >= static_cast<long>(size_)) c = static_cast<long>(size_) - 1;
        const auto next = static_cast<size_t>(c);
        if (next == cursor_) return Action::None;
        cursor_ = next;
        return Action::CursorChanged;
    }

    Action onPress()      { return Action::Selected; }
    Action onLongPress()  { return Action::Back; }

private:
    size_t size_;
    size_t cursor_ = 0;
};

}  // namespace howler::domain
