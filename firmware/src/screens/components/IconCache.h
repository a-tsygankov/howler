#pragma once

// Tiny LRU-ish cache of 24×24 1-bit icon bitmaps fetched from the
// backend's `/api/icons/:name` endpoint. The cache holds the raw
// 72-byte bitmap plus the LVGL image descriptor that points into it,
// so callers can call `lv_image_set_src(img, dsc)` and have LVGL
// blit the cached pixels directly.
//
// Lifecycle: on first request for a name we synchronously fetch the
// bytes and store them. Subsequent requests within `kTtlSec` return
// the cached entry without hitting the network. A capped cache keeps
// PSRAM bounded; eviction is "drop the oldest fetched" — adequate
// because the dashboard surfaces ≤ 20 distinct icons in practice.
//
// The cache is build-time configurable for the bitmap dimensions
// (default 24×24 from the backend's seed), and stores entries as
// LV_COLOR_FORMAT_A1 — i.e. each bit is an alpha mask. LVGL paints
// the image in whatever fg colour the parent prescribes.
//
// This file is firmware-only: the host build doesn't pull it in.

#include "../../application/Ports.h"

#include <Arduino.h>
#include <lvgl.h>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

namespace howler::screens::components {

class IconCache {
public:
    /// On-the-wire bitmap dimensions. Both seed and runtime fix this
    /// at 24×24 today; bumping it would require regenerating the seed
    /// migration AND adapting buildStatusAvatar's inner content.
    static constexpr int kIconW = 24;
    static constexpr int kIconH = 24;
    /// Bytes received from the server: 1-bit packed (24 px / 8 = 3
    /// bytes per row × 24 rows = 72 bytes). LVGL 9's software
    /// renderer doesn't support LV_COLOR_FORMAT_A1 (lv_color.h line
    /// 137 explicitly excludes A1/A2/A4 as "GPU-only"), so on the
    /// device we unpack 1bpp → 8bpp A8 and feed THAT to lv_image —
    /// 0xFF for set pixels, 0x00 for unset. The unpacked buffer is
    /// 24 × 24 = 576 bytes per icon.
    static constexpr size_t kPackedBytes   = (kIconW * kIconH) / 8;  // 72
    static constexpr size_t kUnpackedBytes = kIconW * kIconH;        // 576

    /// Cache TTL — once an entry is `kTtlSec` old we'll re-fetch it
    /// on the next access. The backend's icons rarely change, so an
    /// hour is a comfortable balance between freshness and chatter.
    static constexpr uint32_t kTtlSec = 3600;
    /// Hard cap on cached entries; oldest gets evicted on overflow.
    /// Sized to comfortably cover the entire LABEL_ICON_CHOICES set
    /// (currently 20 names) plus a bit of headroom.
    static constexpr size_t kMaxEntries = 32;

    IconCache(application::INetwork& net,
              application::IClock& clock)
        : net_(net), clock_(clock) {}

    /// Look up `name` in the cache. NEVER blocks on the network —
    /// returns nullptr if not cached and silently enqueues the name
    /// for `tickPrefetch` to fetch in the background. Callers
    /// render a fallback glyph (badgeTextForIcon / initials) when
    /// the result is null, then re-render after a future tick once
    /// the icon lands in the cache (`generation()` bumps when an
    /// async fetch completes).
    const lv_image_dsc_t* get(const std::string& name) {
        if (name.empty()) return nullptr;
        for (auto& e : entries_) {
            if (e.name == name) return &e.descriptor;
        }
        // Miss — queue it. Dedup against pending list so a screen
        // with many copies of the same icon (multiple tasks with
        // avatarId="icon:paw") only triggers one fetch.
        for (const auto& q : pending_) {
            if (q == name) return nullptr;
        }
        pending_.push_back(name);
        return nullptr;
    }

    /// Drain up to `maxPerTick` queued fetches. Called from the
    /// main tick loop so the synchronous HTTP I/O happens off the
    /// render path. Returns how many fetches actually completed
    /// (server might 404 or be offline); callers that want to
    /// re-render on cache change can watch `generation()` instead.
    int tickPrefetch(int maxPerTick = 1) {
        int fetched = 0;
        while (maxPerTick-- > 0 && !pending_.empty()) {
            const std::string name = std::move(pending_.front());
            pending_.erase(pending_.begin());
            // Race guard: another get() may have ended up with this
            // name in entries_ via a manual seed path. Skip the dup.
            bool already = false;
            for (auto& e : entries_) {
                if (e.name == name) { already = true; break; }
            }
            if (already) continue;
            if (entries_.size() >= kMaxEntries) {
                entries_.erase(entries_.begin());
            }
            entries_.emplace_back();
            Entry& e = entries_.back();
            e.name = name;
            if (!tryFetchInto(name, e)) {
                // Drop the empty slot; don't requeue (avoid thrash on
                // permanent failures like 404). Caller's next get()
                // will re-enqueue if it still wants the icon.
                entries_.pop_back();
                continue;
            }
            ++fetched;
            ++generation_;
        }
        return fetched;
    }

    /// True iff at least one name is queued for background fetch.
    /// ScreenManager uses this to schedule the next tickPrefetch
    /// without polling.
    bool hasPending() const { return !pending_.empty(); }

    /// Bulk-enqueue a list of icon names — used to pre-warm the
    /// cache at boot so the first dashboard render shows real
    /// icons instead of fallback letters. Already-cached and
    /// already-queued names are skipped, so this is idempotent.
    void prewarm(const std::vector<std::string>& names) {
        for (const auto& name : names) {
            if (name.empty()) continue;
            bool seen = false;
            for (const auto& e : entries_) {
                if (e.name == name) { seen = true; break; }
            }
            if (seen) continue;
            for (const auto& q : pending_) {
                if (q == name) { seen = true; break; }
            }
            if (seen) continue;
            pending_.push_back(name);
        }
    }

    /// Monotonically advancing counter, bumped by every successful
    /// background fetch. Screens watch this to trigger a rebuild
    /// when icons that previously rendered as fallback glyphs are
    /// now available as bitmaps.
    uint32_t generation() const { return generation_; }

    /// Drop everything. Useful for tests + after a sign-out where
    /// the device token rotated and the cached icons are still
    /// "valid" but tied to the old auth boundary.
    void clear() {
        entries_.clear();
        pending_.clear();
        ++generation_;
    }

    size_t size() const { return entries_.size(); }

private:
    struct Entry {
        std::string      name;
        uint8_t          bitmap[kUnpackedBytes] = {};  // 576 B unpacked A8
        lv_image_dsc_t   descriptor{};
        int64_t          fetchedAt = 0;
        std::string      contentHash;
    };

    application::INetwork&   net_;
    application::IClock&     clock_;
    std::vector<Entry>       entries_;
    std::vector<std::string> pending_;
    uint32_t                 generation_ = 0;

    /// Pull bytes from the network into `e`. The wire payload is
    /// 1-bit packed (72 bytes); we unpack to A8 (576 bytes) on the
    /// way in so LVGL's software renderer can paint it. Sets up the
    /// LVGL image descriptor pointing at the unpacked buffer
    /// (stable for the lifetime of the entry). Returns true on
    /// success.
    bool tryFetchInto(const std::string& name, Entry& e) {
        std::string body;
        std::string hash;
        const auto r = net_.fetchIcon(name, body, hash);
        if (!r.isOk()) return false;
        if (body.size() != kPackedBytes) return false;

        // Unpack 1bpp MSB-first → A8. Set bits become 0xFF (fully
        // opaque, painted in the recolor); unset stays 0x00
        // (transparent → disc background shows through).
        const uint8_t* packed = reinterpret_cast<const uint8_t*>(body.data());
        for (int y = 0; y < kIconH; ++y) {
            for (int x = 0; x < kIconW; ++x) {
                const int byteIdx = y * (kIconW / 8) + (x >> 3);
                const int bitIdx  = 7 - (x & 7);
                const bool set    = (packed[byteIdx] >> bitIdx) & 1;
                e.bitmap[y * kIconW + x] = set ? 0xFF : 0x00;
            }
        }

        // LVGL 9 image descriptor for an A8 (8-bit alpha) bitmap —
        // explicitly listed as software-renderer-supported (lv_color.h
        // line 126); A1 is GPU-only and silently produces garbage on
        // a CPU-render path like ours.
        e.descriptor.header.cf      = LV_COLOR_FORMAT_A8;
        e.descriptor.header.w       = kIconW;
        e.descriptor.header.h       = kIconH;
        e.descriptor.header.stride  = kIconW;             // 24 bytes / row
        e.descriptor.data_size      = kUnpackedBytes;
        e.descriptor.data           = e.bitmap;
        e.fetchedAt                 = clock_.nowEpochSeconds();
        e.contentHash               = std::move(hash);
        return true;
    }
};

}  // namespace howler::screens::components
