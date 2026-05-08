#include "App.h"

namespace howler::application {

namespace {

constexpr const char* kSettingsKey = "howler.settings";

void putU8(std::string& s, uint8_t v) { s.push_back(static_cast<char>(v)); }
void putU16(std::string& s, uint16_t v) {
    s.push_back(static_cast<char>(v & 0xFF));
    s.push_back(static_cast<char>((v >> 8) & 0xFF));
}
void putStr(std::string& s, const std::string& v) {
    putU16(s, static_cast<uint16_t>(v.size() & 0xFFFF));
    s.append(v);
}
bool readU8(const std::string& s, size_t& off, uint8_t& out) {
    if (off >= s.size()) return false;
    out = static_cast<uint8_t>(s[off++]);
    return true;
}
bool readU16(const std::string& s, size_t& off, uint16_t& out) {
    if (off + 2 > s.size()) return false;
    out = static_cast<uint16_t>(static_cast<uint8_t>(s[off])) |
          (static_cast<uint16_t>(static_cast<uint8_t>(s[off + 1])) << 8);
    off += 2;
    return true;
}
bool readStr(const std::string& s, size_t& off, std::string& out) {
    uint16_t n = 0;
    if (!readU16(s, off, n)) return false;
    if (off + n > s.size()) return false;
    out.assign(s.data() + off, n);
    off += n;
    return true;
}

}  // namespace

App::App(INetwork& net,
         IPairApi& pairApi,
         IClock& clock,
         IRandom& rng,
         IStorage& storage,
         IInputDevice& input,
         IWifi& wifi,
         ILedRing& led,
         std::string deviceId)
    : net_(net), pairApi_(pairApi), clock_(clock), rng_(rng),
      storage_(storage), input_(input), wifi_(wifi), led_(led),
      sync_(net_, clock_, occList_, dashboard_, allTasks_,
            users_, resultTypes_, watermark_),
      markDoneSvc_(net_, clock_, rng_, storage_, queue_),
      pairCoord_(pairApi_, storage_, clock_),
      deviceId_(std::move(deviceId)) {}

void App::begin() {
    restoreSettings();
    markDoneSvc_.restoreFromStorage();
    if (PairCoordinator::isPaired(storage_)) {
        router_.replaceRoot(howler::domain::ScreenId::Dashboard);
    } else {
        router_.replaceRoot(howler::domain::ScreenId::Pair);
        pairCoord_.start(deviceId_);
    }
}

namespace {

// Map dashboard contents to a status colour for the LED ring.
//   any urgent or missed → red    (matches webapp accent)
//   any soon (NonUrgent) → amber  (warn)
//   only hidden / empty  → off
//
// Offline takes precedence: when the network adapter says we're
// disconnected, the ring shows a dim cool-tone instead of the
// urgency colour so the user has an unmissable cue. We keep the
// urgency colour visible during "Stale" because the data we have
// is still the authoritative state of the home — only "Offline"
// is an actively misleading scenario.
//
// 0xRR_GG_BB packed for Adafruit_NeoPixel.
constexpr uint32_t kLedRed   = 0x00C13D1E;
constexpr uint32_t kLedAmber = 0x00C88310;
constexpr uint32_t kLedGreen = 0x002C774B;
constexpr uint32_t kLedCold  = 0x00203570;  // dim cool blue — offline

uint32_t pickLedAmbient(App::NetworkHealth nh,
                        const howler::domain::DashboardModel& d) {
    if (nh == App::NetworkHealth::Offline) return kLedCold;
    bool hasUrgent = false;
    bool hasSoon   = false;
    for (const auto& it : d.items()) {
        if (it.urgency == howler::domain::Urgency::Urgent || it.isMissed) {
            hasUrgent = true;
            break;  // urgent dominates; no need to keep scanning
        }
        if (it.urgency == howler::domain::Urgency::NonUrgent) hasSoon = true;
    }
    if (hasUrgent) return kLedRed;
    if (hasSoon)   return kLedAmber;
    return 0;  // off
}

}  // namespace

App::NetworkHealth App::networkHealth() const {
    // Constants live here (not the header) to keep them tunable
    // without touching every translation unit that includes App.h.
    constexpr int64_t kStaleAfterSec = 120;
    if (!net_.isOnline()) return NetworkHealth::Offline;
    if (watermark_.lastFullSync == 0) {
        // We're online but haven't completed a sync yet — treat as
        // Stale rather than Fresh so the user sees a hint that data
        // hasn't loaded. Settles to Fresh on the first successful
        // round (typically within 1–2 s of association).
        return NetworkHealth::Stale;
    }
    const int64_t now = clock_.nowEpochSeconds();
    const int64_t age = now - watermark_.lastFullSync;
    if (age > kStaleAfterSec) return NetworkHealth::Stale;
    return NetworkHealth::Fresh;
}

void App::tick(uint32_t /*millisNow*/) {
    sync_.tick();
    markDoneSvc_.tick();
    pairCoord_.tick();

    // Mirror the dashboard's worst tier on the LED ring (overridden
    // to a cool tone when we're offline). The adapter drops needless
    // re-renders when the colour hasn't changed so calling on every
    // tick is cheap.
    led_.setAmbient(pickLedAmbient(networkHealth(), dashboard_));
    led_.tick();

    // If pairing just confirmed, slide into the dashboard. The screen
    // layer will pick up the router change next frame.
    if (pairCoord_.state().phase == howler::domain::PairPhase::Confirmed
        && router_.current() == howler::domain::ScreenId::Pair) {
        router_.replaceRoot(howler::domain::ScreenId::Dashboard);
        sync_.requestSync();
    }
}

bool App::refreshWifiScan() {
    return wifi_.scan(wifiScan_);
}

bool App::saveAndConnectWifi(const howler::domain::WifiConfig& cfg) {
    // Persist before the connect attempt so a successful association
    // immediately survives a reboot. Plaintext for now (plan §10 #3).
    std::string blob;
    blob.reserve(cfg.ssid.size() + cfg.secret.size() + 4);
    auto putStr = [&](const std::string& s) {
        const uint16_t n = static_cast<uint16_t>(s.size() & 0xFFFF);
        blob.push_back(static_cast<char>(n & 0xFF));
        blob.push_back(static_cast<char>((n >> 8) & 0xFF));
        blob.append(s);
    };
    putStr(cfg.ssid);
    putStr(cfg.secret);
    storage_.writeBlob("howler.wifi", blob);
    return wifi_.connect(cfg);
}

void App::toggleTheme() {
    setTheme(settings_.theme == howler::domain::Theme::Dark
             ? howler::domain::Theme::Light
             : howler::domain::Theme::Dark);
}

void App::setTheme(howler::domain::Theme t) {
    if (settings_.theme == t) return;
    settings_.theme = t;
    persistSettings();
}

void App::commitPendingDone() {
    const auto& p = pendingDone_;
    if (p.taskId.empty()) return;
    markDoneSvc_.enqueue(p.taskId, p.occurrenceId, p.userId,
                         p.hasResultValue, p.resultValue);
    if (p.hasResultValue) rememberLastValue(p.taskId, p.resultValue);
    // Optimistic UI: drop the row from both the focused dashboard
    // and the all-tasks list so the user sees feedback even when
    // offline. The next successful sync round refills both models
    // from the server, so any optimism we got wrong self-corrects.
    const std::string id =
        !p.occurrenceId.empty() ? p.occurrenceId : p.taskId.hex();
    dashboard_.removeById(id);
    allTasks_.removeById(id);
    // Confirmation flash on the LED ring. Reverts to whatever ambient
    // colour the next tick computes — usually still red/amber if the
    // home has more urgent items, or off once the user has cleared
    // the queue.
    led_.pulse(kLedGreen, 600);
    sync_.requestSync();
    clearPendingDone();
}

const howler::domain::ResultType*
App::findResultType(const std::string& id) const {
    if (id.empty()) return nullptr;
    for (const auto& t : resultTypes_) {
        if (t.id == id) return &t;
    }
    return nullptr;
}

bool App::lastValueForTask(const howler::domain::TaskId& id,
                           double& outValue) const {
    for (const auto& lv : lastValues_) {
        if (lv.taskHex == id.hex()) {
            outValue = lv.value;
            return true;
        }
    }
    return false;
}

void App::rememberLastValue(const howler::domain::TaskId& id, double value) {
    for (auto& lv : lastValues_) {
        if (lv.taskHex == id.hex()) {
            lv.value = value;
            return;
        }
    }
    if (lastValues_.size() >= kLastValueCap) {
        lastValues_.erase(lastValues_.begin());
    }
    lastValues_.push_back({id.hex(), value});
}

void App::restoreSettings() {
    std::string bytes;
    if (!storage_.readBlob(kSettingsKey, bytes) || bytes.empty()) return;
    size_t off = 0;
    uint8_t version = 0;
    if (!readU8(bytes, off, version)) return;
    if (version < 1 || version > 2) return;
    uint8_t brightness = 0;
    uint16_t syncSec = 0;
    std::string tz, name;
    if (!readU8(bytes, off, brightness)) return;
    if (!readU16(bytes, off, syncSec)) return;
    if (!readStr(bytes, off, tz)) return;
    if (!readStr(bytes, off, name)) return;
    settings_.brightness = brightness;
    settings_.foregroundSyncSec = syncSec ? syncSec : 30;
    settings_.homeTz = tz;
    settings_.deviceName = name;
    // Theme byte landed in v2 — older NVS rows skip it and stay on
    // the Light default. The version() guard above accepts both so
    // we don't trip a "settings unreadable" error post-upgrade.
    if (version >= 2) {
        uint8_t themeByte = 0;
        if (readU8(bytes, off, themeByte)) {
            settings_.theme = (themeByte == 1)
                ? howler::domain::Theme::Dark
                : howler::domain::Theme::Light;
        }
    }
}

void App::persistSettings() {
    std::string bytes;
    putU8(bytes, 2);  // version 2: appended theme byte
    putU8(bytes, settings_.brightness);
    putU16(bytes, settings_.foregroundSyncSec);
    putStr(bytes, settings_.homeTz);
    putStr(bytes, settings_.deviceName);
    putU8(bytes, settings_.theme == howler::domain::Theme::Dark ? 1 : 0);
    storage_.writeBlob(kSettingsKey, bytes);
}

}  // namespace howler::application
