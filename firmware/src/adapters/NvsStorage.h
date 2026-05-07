#pragma once

#include "../application/Ports.h"

#include <Arduino.h>
#include <Preferences.h>

namespace howler::adapters {

/// Wraps ESP32 NVS via the Arduino `Preferences` library. Keys are
/// limited to 15 chars by NVS, so we hash long names down — except
/// the convention used by the application layer is already short
/// ("howler.queue", "howler.token" etc.) which fits exactly.
class NvsStorage : public howler::application::IStorage {
public:
    bool readBlob(const std::string& key, std::string& outBytes) override {
        if (!begin(key, true)) return false;
        const size_t len = prefs_.getBytesLength(rootKey(key));
        if (len == 0) { prefs_.end(); return false; }
        outBytes.resize(len);
        const size_t got = prefs_.getBytes(rootKey(key), outBytes.data(), len);
        prefs_.end();
        return got == len;
    }

    bool writeBlob(const std::string& key, const std::string& bytes) override {
        if (!begin(key, false)) return false;
        const size_t put = prefs_.putBytes(rootKey(key), bytes.data(), bytes.size());
        prefs_.end();
        return put == bytes.size();
    }

    bool eraseKey(const std::string& key) override {
        if (!begin(key, false)) return false;
        const bool ok = prefs_.remove(rootKey(key));
        prefs_.end();
        return ok;
    }

private:
    Preferences prefs_;

    bool begin(const std::string& key, bool readOnly) {
        // Single namespace; the leading "howler." prefix in the app's
        // keys does double duty as the NVS namespace and the key name.
        // We split on the dot so NVS gets a 6-char namespace.
        const auto dot = key.find('.');
        const std::string ns = (dot == std::string::npos) ? "howler" : key.substr(0, dot);
        return prefs_.begin(ns.c_str(), readOnly);
    }

    static const char* rootKey(const std::string& key) {
        const auto dot = key.find('.');
        return dot == std::string::npos ? key.c_str() : key.c_str() + dot + 1;
    }
};

}  // namespace howler::adapters
