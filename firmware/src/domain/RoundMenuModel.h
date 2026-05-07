#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace howler::domain {

/// One row in a round menu — the LVGL renderer pulls these out and
/// builds the on-screen widgets. `iconKey` is opaque (the renderer
/// looks it up in its own asset table); `accent` is a 24-bit RGB hint
/// for status colours (e.g. red for the urgent dashboard tier, dark
/// for non-urgent).
struct RoundMenuItem {
    std::string id;
    std::string title;
    std::string subtitle;       // optional (rendered smaller / muted)
    std::string iconKey;        // optional ("home", "calendar", "x", …)
    uint32_t    accent = 0;     // 0xRRGGBB; 0 = inherit from theme
    bool        destructive = false;  // long-press shows red arc
};

/// Pure presentation model for any round menu — Dashboard, Settings,
/// User picker. The renderer (LVGL ScreenManager) snapshots `items()`
/// and `cursor()` each frame; rotation events translate to
/// `moveCursor`. Host-testable; the UI layer never reads these
/// fields directly, only via the accessors here.
class RoundMenuModel {
public:
    void replace(std::vector<RoundMenuItem> next) {
        items_ = std::move(next);
        if (cursor_ >= items_.size()) cursor_ = items_.empty() ? 0 : items_.size() - 1;
    }

    void replacePreservingCursor(std::vector<RoundMenuItem> next) {
        const std::string sticky = cursorId();
        items_ = std::move(next);
        if (!sticky.empty()) {
            for (size_t i = 0; i < items_.size(); ++i) {
                if (items_[i].id == sticky) { cursor_ = i; return; }
            }
        }
        if (cursor_ >= items_.size()) cursor_ = items_.empty() ? 0 : items_.size() - 1;
    }

    const std::vector<RoundMenuItem>& items() const { return items_; }
    size_t size()   const { return items_.size(); }
    size_t cursor() const { return cursor_; }
    bool   empty()  const { return items_.empty(); }

    const RoundMenuItem* selected() const {
        return items_.empty() ? nullptr : &items_[cursor_];
    }

    /// Wrap-around cursor step (default behaviour for round menus —
    /// the user can spin past the end and come back to the start).
    void moveCursor(int delta) {
        if (items_.empty()) { cursor_ = 0; return; }
        const long n = static_cast<long>(items_.size());
        long c = static_cast<long>(cursor_) + delta;
        c = ((c % n) + n) % n;
        cursor_ = static_cast<size_t>(c);
    }

    void setCursor(size_t i) {
        cursor_ = items_.empty() ? 0 : (i % items_.size());
    }

    void removeById(const std::string& id) {
        for (size_t i = 0; i < items_.size(); ++i) {
            if (items_[i].id == id) {
                items_.erase(items_.begin() + i);
                if (cursor_ >= items_.size()) cursor_ = items_.empty() ? 0 : items_.size() - 1;
                else if (cursor_ > i) --cursor_;
                return;
            }
        }
    }

private:
    std::vector<RoundMenuItem> items_;
    size_t cursor_ = 0;

    std::string cursorId() const {
        return items_.empty() ? std::string{} : items_[cursor_].id;
    }
};

}  // namespace howler::domain
