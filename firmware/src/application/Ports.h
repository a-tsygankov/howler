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

    /// Pull a 24×24 1-bit icon bitmap from the server, keyed by name
    /// (matches webapp Icon.tsx). On success, `outBitmap` receives the
    /// 72-byte raw blob and `outHash` the response's content hash so
    /// the cache can do conditional-revalidation on subsequent calls.
    /// Returning Permanent for 404 lets the device skip re-requesting
    /// names the server doesn't carry. The default impl returns
    /// transient so host stubs that don't override see "not yet
    /// loaded" instead of crashing.
    virtual NetResult fetchIcon(const std::string& /*name*/,
                                std::string& /*outBitmap*/,
                                std::string& /*outHash*/) {
        return NetResult::transient(0);
    }

    /// Fetch the icon manifest — list of all names the backend has
    /// seeded. Used by the IconCache to prewarm without hardcoding
    /// the full LABEL_ICON_CHOICES list firmware-side; if the
    /// manifest endpoint fails the caller falls back to a static
    /// list it knows about. Default impl returns transient so host
    /// stubs that don't override see "no manifest available".
    virtual NetResult fetchIconManifest(std::vector<std::string>& /*outNames*/) {
        return NetResult::transient(0);
    }

    /// GET /api/homes/peek — returns the home's monotonically-
    /// incremented update_counter. SyncService caches the value and
    /// only fires the four big fetches when the counter advances,
    /// per docs/sync-analysis.md (slice A). One TLS handshake +
    /// ~200 B response replaces the four-fetch idle round.
    /// Default impl returns transient so host stubs that don't
    /// override fall back to the always-full-sync behaviour from
    /// before this port existed (cheap to keep working — the stub
    /// just sees "peek failed, fetch everything").
    virtual NetResult peekHomeCounter(int64_t& /*outCounter*/) {
        return NetResult::transient(0);
    }
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
    /// Inertial-swipe magnitude for the most-recently dequeued
    /// Swipe* event. Slow swipes return 1; fast flicks return larger
    /// values (capped at ~5) so callers can advance their cursor by
    /// multiple items in one gesture, iPhone-list-style. Reading
    /// after a non-Swipe event returns 1. Implementations without
    /// velocity tracking always return 1.
    virtual int lastSwipeMagnitude() const { return 1; }
};

/// LVGL-or-whatever display abstraction. Application calls `tick()`
/// from its main loop so the display can run animations.
class IDisplay {
public:
    virtual ~IDisplay() = default;
    virtual void tick(uint32_t millis) = 0;
};

/// Optional status LED ring (5×WS2812 on the CrowPanel bezel — the
/// adapter encapsulates the pixel driver). The App calls `setAmbient`
/// every sync round to mirror the dashboard's worst-tier colour, and
/// `pulse` on `commitPendingDone` to flash green for a successful
/// mark-done. Stub implementations (NoopLed for hosts without the
/// hardware) silently no-op.
class ILedRing {
public:
    virtual ~ILedRing() = default;
    /// Set the steady ambient colour. 0 = off. Calling with the same
    /// colour twice is a no-op so the App can poll-set without
    /// thrashing the pixel bus.
    virtual void setAmbient(uint32_t color) = 0;
    /// Brief bright flash, reverts to ambient afterwards.
    virtual void pulse(uint32_t color, uint16_t durationMs = 600) = 0;
    /// Drive the breathing animation. Should be called every loop().
    virtual void tick() = 0;
};

/// Trivial no-op LED ring for builds without WS2812 hardware (host
/// tests, future minimal SKUs).
class NoopLedRing : public ILedRing {
public:
    void setAmbient(uint32_t) override {}
    void pulse(uint32_t, uint16_t = 600) override {}
    void tick() override {}
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

    /// RSSI in dBm of the current association (closer to 0 = stronger,
    /// typical home values -50…-75). Returns 0 when not associated or
    /// when the adapter can't report — diagnostics surface treats 0
    /// as "unknown" and renders "—".
    virtual int8_t currentRssi() const { return 0; }
    /// Dotted-quad IPv4 address from DHCP, or empty when not
    /// associated / no lease yet. Default impl returns empty so the
    /// host-side test stubs and noop adapters don't have to implement
    /// anything Wi-Fi-specific to compile.
    virtual std::string currentIp() const { return {}; }
};

}  // namespace howler::application
