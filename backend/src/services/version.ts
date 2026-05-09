// Pure semver-style version compare. Splits on "." and compares
// each component numerically when both sides parse as digits;
// otherwise falls back to lexicographic. A non-numeric tail
// segment ("1.4.2-beta") sorts BEFORE the bare numeric form
// ("1.4.2") so the latter is "newer" — same shape as
// node `semver.compare` without the dependency.
//
// Returns: negative if a < b, 0 if equal, positive if a > b.
//
// Used by Phase 6 OTA — both /api/firmware/check (returns the
// highest-numbered active release > device's reported fwVersion)
// and /api/devices/heartbeat (advises the same comparison so the
// dial knows to call /firmware/check next round).
export const compareVersions = (a: string, b: string): number => {
  const pa = a.split(".");
  const pb = b.split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const sa = pa[i] ?? "0";
    const sb = pb[i] ?? "0";
    const aNum = /^\d+$/.test(sa);
    const bNum = /^\d+$/.test(sb);
    if (aNum && bNum) {
      const na = Number.parseInt(sa, 10);
      const nb = Number.parseInt(sb, 10);
      if (na !== nb) return na - nb;
    } else if (aNum !== bNum) {
      // Numeric > non-numeric (so "1.4.2" > "1.4.2-beta").
      return aNum ? 1 : -1;
    } else {
      const cmp = sa.localeCompare(sb);
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
};
