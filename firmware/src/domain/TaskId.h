#pragma once

#include <array>
#include <cstdint>
#include <string>

namespace howler::domain {

/// 32-char lowercase-hex UUID. Identity is opaque — never derived
/// from a device-local index (plan §6 / Feedme migration 0008 lesson).
class TaskId {
public:
    TaskId() = default;
    explicit TaskId(std::string hex) : hex_(std::move(hex)) {}

    const std::string& hex() const { return hex_; }
    bool empty() const { return hex_.empty(); }
    bool operator==(const TaskId& o) const { return hex_ == o.hex_; }

private:
    std::string hex_;
};

}  // namespace howler::domain
