#pragma once

#include <cstdint>
#include <string>

namespace howler::domain {

/// Phases of the device-pairing flow (plan §10.2).
///
///   Idle     → device has no token. User can hit "pair" from settings
///              (or the boot screen if no token is present).
///   Started  → POST /api/pair/start succeeded; we have a 6-digit code
///              and an expiresAt. Device shows the code + a QR encoding
///              the deep-link `https://app.example/pair?code=…`.
///   Pending  → polling /api/pair/check; server hasn't seen confirm yet.
///   Confirmed→ /api/pair/check returned `confirmed` with a deviceToken.
///              The token has been persisted to NVS; transition to
///              Online state and pop the pair screen.
///   Expired  → server returned `expired`. UI offers "try again" → Idle.
///   Cancelled→ server returned `cancelled`. UI offers "try again".
///   Failed   → network error or unrecognized status. UI offers retry.
enum class PairPhase : uint8_t {
    Idle,
    Started,
    Pending,
    Confirmed,
    Expired,
    Cancelled,
    Failed,
};

/// Snapshot of the pair flow. Pure — the coordinator advances it via
/// transition methods and persists the token side-band on Confirmed.
struct PairState {
    PairPhase   phase     = PairPhase::Idle;
    std::string pairCode;             // 6 digits, valid in Started/Pending
    std::string deviceToken;          // populated only in Confirmed (transient)
    int64_t     expiresAt = 0;        // epoch seconds (Started/Pending only)
    int64_t     lastPolledAt = 0;     // for poll-throttling
    std::string lastError;            // empty unless Failed
};

}  // namespace howler::domain
