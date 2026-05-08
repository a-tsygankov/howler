#pragma once

// Pure-virtual ports the application layer depends on. Concrete
// adapters live in src/adapters/. Native tests use Stub*/Noop*
// variants from there too (and the host-side unit tests in
// test/test_*).

#include "../domain/DashboardItem.h"
#include "../domain/MarkDoneDraft.h"
#include "../domain/Occurrence.h"
#include "../domain/PairState.h"
#include "../domain/ResultType.h"
#include "../domain/Settings.h"
#include "../domain/SyncWatermark.h"
#include "../domain/User.h"
#include "../domain/WifiConfig.h"

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace howler::application {

class IClock {
public:
    virtual ~IClock() = default;
    virtual int64_t nowEpochMillis() const = 0;
    /// Wall-clock seconds from NTP if available, else fallback to a
    /// monotonic-ish boot offset. Used as the `ts` for executions
    /// queued offline.
    virtual int64_t nowEpochSeconds() const = 0;
};

class IRandom {
public:
    virtual ~IRandom() = default;
    /// 32-hex UUID (no dashes), matching the server's `id` columns.
    virtual std::string newUuidHex() = 0;
};

/// Result of one network call. Status carries enough to decide
/// "retry later" vs. "drop the draft" — 4xx are permanent rejections
/// from the server (auth invalid, malformed body), 5xx and connection
/// errors are transient and worth retrying.
struct NetResult {
    enum class Kind : uint8_t { Ok, Transient, Permanent };
    Kind   kind;
    int    httpStatus;     // 0 if no response was received
    std::string body;      // empty unless caller needs the parsed payload

    static NetResult ok(std::string b = {})        { return {Kind::Ok, 200, std::move(b)}; }
    static NetResult transient(int s = 0)          { return {Kind::Transient, s, {}}; }
    static NetResult permanent(int s, std::string b = {}) { return {Kind::Permanent, s, std::move(b)}; }
    bool isOk() const { return kind == Kind::Ok; }
};

/// REST client port. Each method is idempotent on the server (POSTs
/// carry a UUID; GETs are read-only) so retry-on-Transient is safe.
class INetwork {
public:
    virtual ~INetwork() = default;
    virtual bool isOnline() const = 0;

    virtual NetResult fetchPending(std::vector<howler::domain::Occurrence>& out) = 0;
    virtual NetResult fetchDashboard(std::vector<howler::domain::DashboardItem>& out,
                                     int64_t& serverNowSec) = 0;
    virtual NetResult fetchUsers(std::vector<howler::domain::User>& out) = 0;
    virtual NetResult fetchResultTypes(std::vector<howler::domain::ResultType>& out) = 0;

    /// Mark-done. Behaviour depends on whether the draft has an
    /// occurrenceId: we POST /occurrences/:id/ack when present, else
    /// /tasks/:taskId/complete. Both endpoints are idempotent on the
    /// (occurrenceId | executionId) primary key.
    virtual NetResult postMarkDone(const howler::domain::MarkDoneDraft& d) = 0;

    virtual NetResult postHeartbeat(const std::string& fwVersion) = 0;
};

/// Pair flow client. Separate from INetwork because PairApi can be
/// called *before* a deviceToken exists (using only the deviceId);
/// INetwork requires a token.
class IPairApi {
public:
    virtual ~IPairApi() = default;
    /// Start a fresh pairing or refresh an existing pending one. On
    /// success populates `state.pairCode` and `state.expiresAt`; phase
    /// becomes `Started`.
    virtual NetResult start(const std::string& deviceId,
                            howler::domain::PairState& state) = 0;
    /// Poll the current pairing state. Updates `state.phase` and, on
    /// `Confirmed`, populates `state.deviceToken`.
    virtual NetResult check(const std::string& deviceId,
                            howler::domain::PairState& state) = 0;
};

/// Encoder + tactile button + capacitive touch. `poll()` returns at
/// most one event per call; multiple events queue up in the adapter's
/// ring buffer.
///
/// Interaction model (user spec 2026-05-07):
///   Press      — tap (single click) → enter / activate
///   DoubleTap  — two clicks within ~400 ms → back / cancel
///   LongPress  — held past threshold → confirm (UI shows arc fill)
///   RotateCW   — knob CW rotation or touch swipe right
///   RotateCCW  — knob CCW rotation or touch swipe left
///
/// Touch and knob produce the same Event types so screens stay
/// input-source-agnostic; the CompositeInput adapter merges them.
class IInputDevice {
public:
    enum class Event : uint8_t {
        None,
        RotateCW,
        RotateCCW,
        Press,
        DoubleTap,
        LongPress,
        /// Vertical touch swipes — SwipeUp = finger moved toward the
        /// top of the screen, SwipeDown = the inverse. ScreenManager
        /// translates these into content-cursor scrolling inside
        /// menus and on the Dashboard / TaskList carousels.
        SwipeUp,
        SwipeDown,
        /// Horizontal touch swipes — SwipeLeft = finger moved toward
        /// the left edge (typical "next" direction in mobile UIs),
        /// SwipeRight = the inverse ("back"). At root level these
        /// cycle the main-screen pills (today / all / menu); inside
        /// non-root flows they're not currently mapped.
        SwipeLeft,
        SwipeRight,
    };
    virtual ~IInputDevice() = default;
    virtual Event poll() = 0;
    /// True while the user is actively holding the knob or pressing
    /// the screen. Powers the LongPress-arc visual: ScreenManager
    /// reads this every frame to advance the arc fill. Default impl
    /// always returns false so legacy stubs without hold-tracking
    /// don't have to opt in.
    virtual bool isHeld() const { return false; }
};

/// LVGL-or-whatever display abstraction. Application calls `tick()`
/// from its main loop so the display can run animations.
class IDisplay {
public:
    virtual ~IDisplay() = default;
    virtual void tick(uint32_t millis) = 0;
};

/// Persistent key/value backed by NVS on hardware, std::map on host.
/// Snapshots are byte-blob round-trips; the application layer is
/// responsible for serialising the domain types onto these bytes.
class IStorage {
public:
    virtual ~IStorage() = default;
    /// Returns false when the key isn't present (caller should treat
    /// this as "first boot" and fall back to defaults).
    virtual bool readBlob(const std::string& key, std::string& outBytes) = 0;
    virtual bool writeBlob(const std::string& key, const std::string& bytes) = 0;
    virtual bool eraseKey(const std::string& key) = 0;
};

/// Wi-Fi station port. Scan + connect; the application doesn't drive
/// the supplicant directly.
class IWifi {
public:
    virtual ~IWifi() = default;
    virtual bool isConnected() const = 0;
    virtual std::string currentSsid() const = 0;
    virtual bool scan(std::vector<howler::domain::WifiNetwork>& out) = 0;
    /// Returns true on association+IP. Persistence is the adapter's
    /// concern — the application calls this with cleartext creds.
    virtual bool connect(const howler::domain::WifiConfig& cfg) = 0;
    virtual void disconnect() = 0;
};

}  // namespace howler::application
