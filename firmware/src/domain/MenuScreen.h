#pragma once

#include <functional>
#include <string>
#include <vector>

namespace howler::domain {

/// One item arranged on the circular menu (plan §11).
struct MenuItem {
    std::string id;
    std::string label;
    std::function<void()> activate;
};

/// Screen-side contract. The framework enforces long-press-to-up,
/// tap-to-activate, knob-to-rotate, and label marquee. Each screen
/// just declares what's on the circle and what its label says.
class MenuScreen {
public:
    virtual ~MenuScreen() = default;
    virtual std::vector<MenuItem> items() const = 0;
    virtual std::string selectedLabel() const = 0;
    virtual bool longPressArc() const { return true; }
};

}  // namespace howler::domain
