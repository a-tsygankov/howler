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
         std::string deviceId)
    : net_(net), pairApi_(pairApi), clock_(clock), rng_(rng),
      storage_(storage), input_(input),
      sync_(net_, clock_, occList_, dashboard_, users_, resultTypes_, watermark_),
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

void App::tick(uint32_t /*millisNow*/) {
    sync_.tick();
    markDoneSvc_.tick();
    pairCoord_.tick();

    // If pairing just confirmed, slide into the dashboard. The screen
    // layer will pick up the router change next frame.
    if (pairCoord_.state().phase == howler::domain::PairPhase::Confirmed
        && router_.current() == howler::domain::ScreenId::Pair) {
        router_.replaceRoot(howler::domain::ScreenId::Dashboard);
        sync_.requestSync();
    }
}

void App::commitPendingDone() {
    const auto& p = pendingDone_;
    if (p.taskId.empty()) return;
    markDoneSvc_.enqueue(p.taskId, p.occurrenceId, p.userId,
                         p.hasResultValue, p.resultValue);
    // Optimistic UI: remove the row from the dashboard immediately
    // so the user sees feedback even if the network is offline.
    if (!p.occurrenceId.empty()) {
        dashboard_.removeById(p.occurrenceId);
    } else {
        dashboard_.removeById(p.taskId.hex());
    }
    sync_.requestSync();
    clearPendingDone();
}

void App::restoreSettings() {
    std::string bytes;
    if (!storage_.readBlob(kSettingsKey, bytes) || bytes.empty()) return;
    size_t off = 0;
    uint8_t version = 0;
    if (!readU8(bytes, off, version) || version != 1) return;
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
}

void App::persistSettings() {
    std::string bytes;
    putU8(bytes, 1);
    putU8(bytes, settings_.brightness);
    putU16(bytes, settings_.foregroundSyncSec);
    putStr(bytes, settings_.homeTz);
    putStr(bytes, settings_.deviceName);
    storage_.writeBlob(kSettingsKey, bytes);
}

}  // namespace howler::application
