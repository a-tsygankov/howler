#include "MarkDoneService.h"
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <sstream>
#include <string>

namespace howler::application {

namespace {

// Simple length-prefixed wire format. We could use ArduinoJson here
// too, but a hand-rolled TLV is small, allocation-light, and easy to
// host-test without pulling Arduino headers into the native build.
//
//   [u8 version=1] [u16 count]
//     [str executionId] [str taskIdHex] [str occurrenceId]
//     [str userId] [u8 hasResult] [double value]
//     [str notes] [i64 ts] [u16 attempts]
//   ...
//
// Strings are written as [u16 len] [bytes].

void putU8(std::string& s, uint8_t v) { s.push_back(static_cast<char>(v)); }

void putU16(std::string& s, uint16_t v) {
    s.push_back(static_cast<char>(v & 0xFF));
    s.push_back(static_cast<char>((v >> 8) & 0xFF));
}

void putI64(std::string& s, int64_t v) {
    auto u = static_cast<uint64_t>(v);
    for (int i = 0; i < 8; ++i) {
        s.push_back(static_cast<char>(u & 0xFF));
        u >>= 8;
    }
}

void putDouble(std::string& s, double v) {
    char buf[8];
    std::memcpy(buf, &v, 8);
    s.append(buf, 8);
}

void putStr(std::string& s, const std::string& v) {
    putU16(s, static_cast<uint16_t>(v.size() & 0xFFFF));
    s.append(v);
}

bool readBytes(const std::string& s, size_t& off, char* dst, size_t n) {
    if (off + n > s.size()) return false;
    std::memcpy(dst, s.data() + off, n);
    off += n;
    return true;
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

bool readI64(const std::string& s, size_t& off, int64_t& out) {
    if (off + 8 > s.size()) return false;
    uint64_t u = 0;
    for (int i = 0; i < 8; ++i) {
        u |= static_cast<uint64_t>(static_cast<uint8_t>(s[off + i])) << (i * 8);
    }
    off += 8;
    out = static_cast<int64_t>(u);
    return true;
}

bool readDouble(const std::string& s, size_t& off, double& out) {
    char buf[8];
    if (!readBytes(s, off, buf, 8)) return false;
    std::memcpy(&out, buf, 8);
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

constexpr const char* kQueueKey = "howler.queue";

}  // namespace

MarkDoneService::MarkDoneService(INetwork& net,
                                 IClock& clock,
                                 IRandom& rng,
                                 IStorage& storage,
                                 howler::domain::MarkDoneQueue& queue)
    : net_(net), clock_(clock), rng_(rng), storage_(storage), queue_(queue) {}

std::string MarkDoneService::enqueue(const howler::domain::TaskId& taskId,
                                     const std::string& occurrenceId,
                                     const std::string& userId,
                                     bool hasResultValue,
                                     double resultValue) {
    howler::domain::MarkDoneDraft d;
    d.executionId = rng_.newUuidHex();
    d.taskId = taskId;
    d.occurrenceId = occurrenceId;
    d.userId = userId;
    d.hasResultValue = hasResultValue;
    d.resultValue = resultValue;
    d.ts = clock_.nowEpochSeconds();
    d.attempts = 0;
    queue_.enqueue(std::move(d));
    persistToStorage();
    return queue_.items().back().executionId;
}

void MarkDoneService::tick() {
    if (queue_.empty()) return;
    if (!net_.isOnline()) return;
    const int64_t nowMs = clock_.nowEpochMillis();
    if (nowMs - lastAttemptMs_ < kBackoffMs) return;
    lastAttemptMs_ = nowMs;

    auto* d = queue_.frontMut();
    if (!d) return;
    if (d->attempts < UINT16_MAX) d->attempts++;

    const auto r = net_.postMarkDone(*d);
    if (r.kind == NetResult::Kind::Ok || r.kind == NetResult::Kind::Permanent) {
        // Permanent error → drop. The user already saw "done"; the
        // alternative is a stuck queue with no UI to clear it.
        queue_.popFront();
        persistToStorage();
    } else {
        // Transient — leave at head, try again after backoff. The
        // updated `attempts` is already persisted-on-popFront cycle;
        // re-snapshot now so a reboot doesn't replay the same draft
        // indefinitely (the server is idempotent so this is safe).
        persistToStorage();
    }
}

void MarkDoneService::restoreFromStorage() {
    std::string bytes;
    if (!storage_.readBlob(kQueueKey, bytes)) return;
    deserialize(bytes, queue_);
}

void MarkDoneService::persistToStorage() {
    storage_.writeBlob(kQueueKey, serialize(queue_));
}

std::string MarkDoneService::serialize(const howler::domain::MarkDoneQueue& q) {
    std::string out;
    out.reserve(64 * q.items().size() + 4);
    putU8(out, 1);  // version
    putU16(out, static_cast<uint16_t>(q.items().size() & 0xFFFF));
    for (const auto& d : q.items()) {
        putStr(out, d.executionId);
        putStr(out, d.taskId.hex());
        putStr(out, d.occurrenceId);
        putStr(out, d.userId);
        putU8(out, d.hasResultValue ? 1 : 0);
        putDouble(out, d.resultValue);
        putStr(out, d.notes);
        putI64(out, d.ts);
        putU16(out, d.attempts);
    }
    return out;
}

bool MarkDoneService::deserialize(const std::string& bytes, howler::domain::MarkDoneQueue& out) {
    if (bytes.empty()) return false;
    size_t off = 0;
    uint8_t version = 0;
    if (!readU8(bytes, off, version)) return false;
    if (version != 1) return false;
    uint16_t count = 0;
    if (!readU16(bytes, off, count)) return false;
    std::vector<howler::domain::MarkDoneDraft> drafts;
    drafts.reserve(count);
    for (uint16_t i = 0; i < count; ++i) {
        howler::domain::MarkDoneDraft d;
        std::string taskIdHex;
        uint8_t hasResult = 0;
        if (!readStr(bytes, off, d.executionId)) return false;
        if (!readStr(bytes, off, taskIdHex)) return false;
        d.taskId = howler::domain::TaskId(taskIdHex);
        if (!readStr(bytes, off, d.occurrenceId)) return false;
        if (!readStr(bytes, off, d.userId)) return false;
        if (!readU8(bytes, off, hasResult)) return false;
        d.hasResultValue = hasResult != 0;
        if (!readDouble(bytes, off, d.resultValue)) return false;
        if (!readStr(bytes, off, d.notes)) return false;
        if (!readI64(bytes, off, d.ts)) return false;
        if (!readU16(bytes, off, d.attempts)) return false;
        drafts.push_back(std::move(d));
    }
    out.replaceAll(std::move(drafts));
    return true;
}

}  // namespace howler::application
