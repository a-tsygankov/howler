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
    /// 1-bit bitmap dimensions. Both seed and runtime fix this at
    /// 24×24 today; bumping it would require regenerating the seed
    /// migration AND adapting buildStatusAvatar's inner content.
    static constexpr int kIconW = 24;
    static constexpr int kIconH = 24;
    static constexpr size_t kBitmapBytes = (kIconW * kIconH) / 8;  // 72

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

    /// Look up `name` in the cache; if missing or stale, attempts a
    /// fetch via the network. Returns nullptr on miss + fetch failure
    /// so callers can render a fallback (initials / 2-letter code).
    /// The returned pointer is valid until the next fetch (eviction
    /// safety: callers that store the pointer for animation should
    /// re-resolve each frame, but this is cheap — cache lookup is a
    /// linear scan over ≤ 32 entries).
    const lv_image_dsc_t* get(const std::string& name) {
        if (name.empty()) return nullptr;
        const int64_t now = clock_.nowEpochSeconds();
        for (auto& e : entries_) {
            if (e.name != name) continue;
            // Hit. If stale and online, kick a refresh — but still
            // return the (potentially stale) bytes so the user sees
            // SOMETHING while the new fetch races. Refresh is
            // synchronous in this path; future evolution could move
            // it onto a background queue.
            if (e.fetchedAt > 0 &&
                static_cast<uint32_t>(now - e.fetchedAt) > kTtlSec) {
                tryFetchInto(name, e);
            }
            return &e.descriptor;
        }
        // Miss — fetch + insert. Eviction: when full, drop the
        // oldest by fetchedAt (vector's front-ish; actual stale-LRU
        // would need a touched-at column, but we never re-touch on
        // hits in this codebase).
        if (entries_.size() >= kMaxEntries) {
            entries_.erase(entries_.begin());
        }
        entries_.emplace_back();
        Entry& e = entries_.back();
        e.name = name;
        if (!tryFetchInto(name, e)) {
            entries_.pop_back();
            return nullptr;
        }
        return &e.descriptor;
    }

    /// Drop everything. Useful for tests + after a sign-out where
    /// the device token rotated and the cached icons are still
    /// "valid" but tied to the old auth boundary.
    void clear() { entries_.clear(); }

    size_t size() const { return entries_.size(); }

private:
    struct Entry {
        std::string      name;
        uint8_t          bitmap[kBitmapBytes] = {};
        lv_image_dsc_t   descriptor{};
        int64_t          fetchedAt = 0;
        std::string      contentHash;
    };

    application::INetwork& net_;
    application::IClock&   clock_;
    std::vector<Entry>     entries_;

    /// Pull bytes from the network into `e`. Sets up the LVGL image
    /// descriptor pointing at e.bitmap (stable for the lifetime of
    /// the entry). Returns true on success.
    bool tryFetchInto(const std::string& name, Entry& e) {
        std::string body;
        std::string hash;
        const auto r = net_.fetchIcon(name, body, hash);
        if (!r.isOk()) return false;
        if (body.size() != kBitmapBytes) return false;
        std::memcpy(e.bitmap, body.data(), kBitmapBytes);

        // LVGL 9 image descriptor for an A1 (1-bit alpha) bitmap.
        // The header carries width / height / colour-format so the
        // renderer knows how to walk the data buffer below.
        e.descriptor.header.cf      = LV_COLOR_FORMAT_A1;
        e.descriptor.header.w       = kIconW;
        e.descriptor.header.h       = kIconH;
        e.descriptor.header.stride  = kIconW / 8;  // 3 bytes / row
        e.descriptor.data_size      = kBitmapBytes;
        e.descriptor.data           = e.bitmap;
        e.fetchedAt                 = clock_.nowEpochSeconds();
        e.contentHash               = std::move(hash);
        return true;
    }
};

}  // namespace howler::screens::components
