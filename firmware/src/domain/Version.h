#pragma once

// Pure semver-style version compare — port of
// backend/src/services/version.ts.
//
// Splits each side on "." and compares per-segment numerically when
// both sides parse as digits, falling back to lexicographic
// otherwise. A non-numeric tail ("1.4.2-beta") sorts BEFORE the
// bare numeric form ("1.4.2"), matching node `semver.compare`
// without the dependency.
//
// Used by the OTA advisory plumbing (Phase 6, slice F4): the dial
// re-checks the server's advisory locally before kicking off a
// download — defense-in-depth in case a stale rollout rule lets
// us see an OLDER build than what we're already running.

#include <cstdlib>
#include <string>
#include <vector>

namespace howler::domain {

/// Returns negative if a < b, 0 if equal, positive if a > b.
inline int compareVersions(const std::string& a, const std::string& b) {
    auto split = [](const std::string& s, std::vector<std::string>& out) {
        out.clear();
        std::string cur;
        for (char c : s) {
            if (c == '.') {
                out.push_back(std::move(cur));
                cur.clear();
            } else {
                cur.push_back(c);
            }
        }
        out.push_back(std::move(cur));
    };
    auto isNumeric = [](const std::string& s) {
        if (s.empty()) return false;
        for (char c : s) if (c < '0' || c > '9') return false;
        return true;
    };

    std::vector<std::string> pa, pb;
    split(a, pa);
    split(b, pb);
    const size_t len = pa.size() > pb.size() ? pa.size() : pb.size();
    for (size_t i = 0; i < len; ++i) {
        const std::string& sa = i < pa.size() ? pa[i] : std::string("0");
        const std::string& sb = i < pb.size() ? pb[i] : std::string("0");
        const bool aNum = isNumeric(sa);
        const bool bNum = isNumeric(sb);
        if (aNum && bNum) {
            // strtoll is overkill here — version components fit in
            // int. Using long to dodge any 16-bit weirdness on host
            // toolchains; result range is plenty.
            const long na = std::strtol(sa.c_str(), nullptr, 10);
            const long nb = std::strtol(sb.c_str(), nullptr, 10);
            if (na != nb) return na < nb ? -1 : 1;
        } else if (aNum != bNum) {
            // Numeric > non-numeric ⇒ "1.4.2" > "1.4.2-beta".
            return aNum ? 1 : -1;
        } else {
            const int cmp = sa.compare(sb);
            if (cmp != 0) return cmp < 0 ? -1 : 1;
        }
    }
    return 0;
}

}  // namespace howler::domain
