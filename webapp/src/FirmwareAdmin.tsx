// /settings/firmware — Phase 6 OTA admin surface. Lists every
// firmware release joined with the live device fleet so admins
// can:
//
//   • see which versions are promoted vs. yanked;
//   • watch a fresh promotion roll out across devices in real time
//     (recentCount / aliveCount widgets);
//   • spot drift — yanked releases still running in the field, or
//     dev-flashed versions that aren't in the manifest at all;
//   • promote / yank without curl. Rollout rule editing (canary
//     percent, device-id pinning) is intentionally NOT exposed
//     here yet — until ops has used the simpler controls for a
//     while we don't want admins picking partial-rollout knobs
//     they don't understand. PATCH endpoint stays available for
//     scripted use via the same admin token.
//
// Auth: server requires `users.is_admin = 1`; the route is mounted
// in App.tsx behind the same gate. A non-admin who hand-types the
// URL sees the in-page "you're not an admin" message rather than
// the API's opaque 403 — strictly nicer UX without changing the
// security boundary.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiMe,
  fetchFirmwareHealth,
  fetchFirmwareReleases,
  patchFirmwareRelease,
  type FirmwareHealthRow,
  type FirmwareRelease,
} from "./lib/api.ts";

export const FirmwareAdmin = () => {
  const me = useQuery({ queryKey: ["me"], queryFn: apiMe });

  if (me.isLoading) {
    return <Shell><p className="cap">Loading…</p></Shell>;
  }
  if (me.isError) {
    return (
      <Shell>
        <p className="text-sm text-accent-rose">
          {me.error instanceof Error ? me.error.message : "Unknown error"}
        </p>
      </Shell>
    );
  }
  if (!me.data?.isAdmin) {
    return (
      <Shell>
        <p className="text-sm text-ink-2">
          This page is admin-only. Ask your home owner to grant the
          admin flag, or use the regular <Link to="/" className="underline">Dashboard</Link>.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <FirmwareAdminBody />
    </Shell>
  );
};

const Shell = ({ children }: { children: React.ReactNode }) => (
  <main className="mx-auto max-w-3xl px-5 py-6 lg:max-w-4xl">
    <div className="mb-4 flex items-center justify-between">
      <h1 className="font-display text-2xl">Firmware</h1>
      <Link to="/settings" className="cap text-ink-3 hover:text-ink">
        ← Settings
      </Link>
    </div>
    {children}
  </main>
);

const FirmwareAdminBody = () => {
  const qc = useQueryClient();
  const releases = useQuery({
    queryKey: ["firmware", "releases"],
    queryFn: fetchFirmwareReleases,
  });
  const health = useQuery({
    queryKey: ["firmware", "health"],
    queryFn: fetchFirmwareHealth,
    // 30 s — fresh enough to watch a rollout but doesn't pummel the
    // Worker. The page's own refresh button hits both queries
    // immediately when the admin wants the latest.
    refetchInterval: 30_000,
  });

  const patch = useMutation({
    mutationFn: ({
      version,
      patch,
    }: {
      version: string;
      patch: Parameters<typeof patchFirmwareRelease>[1];
    }) => patchFirmwareRelease(version, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["firmware"] });
    },
  });

  if (releases.isLoading || health.isLoading) {
    return <p className="cap">Loading…</p>;
  }
  if (releases.isError || health.isError) {
    const err = releases.error ?? health.error;
    return (
      <p className="text-sm text-accent-rose">
        {err instanceof Error ? err.message : "Failed to load."}
      </p>
    );
  }

  // Index health rows by version so each release can render its
  // device-fleet stats inline. Orphan rows (knownRelease=false) get
  // their own section below the manifest table.
  const healthByVersion = new Map<string, FirmwareHealthRow>();
  for (const v of health.data!.versions) {
    healthByVersion.set(v.version, v);
  }
  const orphans = health.data!.versions.filter((v) => !v.knownRelease);

  return (
    <div className="space-y-6">
      <header className="rounded-lg border border-line-soft bg-paper-2 px-4 py-3 text-sm text-ink-2">
        <p>
          Promoting a release sets <code className="text-ink">active = 1</code>{" "}
          — devices will pick it up on their next{" "}
          <code className="text-ink">/firmware/check</code> poll. Yank flips
          back to <code className="text-ink">active = 0</code>; devices already
          on the yanked build keep running it (the bootloader has no concept of
          server-side yank). To force a downgrade, ship a higher-numbered
          re-release of the older code.
        </p>
        <button
          type="button"
          onClick={() => {
            void qc.invalidateQueries({ queryKey: ["firmware"] });
          }}
          className="mt-2 rounded-md border border-line-soft bg-paper-3 px-3 py-1 text-xs hover:border-line"
        >
          Refresh now
        </button>
      </header>

      <section>
        <h2 className="cap mb-2">Releases</h2>
        {releases.data!.length === 0 ? (
          <p className="text-sm text-ink-2">
            No firmware releases registered. CI will POST one when the next{" "}
            <code className="text-ink">release/v*</code> branch builds.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line-soft">
            <table className="w-full text-sm">
              <thead className="bg-paper-2 text-left text-xs uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-3 py-2">Version</th>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2 text-right">Devices</th>
                  <th className="px-3 py-2 text-right">Alive 24h</th>
                  <th className="px-3 py-2 text-right">Recent 1h</th>
                  <th className="px-3 py-2 text-right">Size</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {releases.data!.map((r) => {
                  const h = healthByVersion.get(r.version);
                  return (
                    <ReleaseRow
                      key={r.version}
                      release={r}
                      health={h ?? null}
                      busy={patch.isPending}
                      onPromote={() =>
                        patch.mutate({
                          version: r.version,
                          patch: { active: true },
                        })
                      }
                      onYank={() =>
                        patch.mutate({
                          version: r.version,
                          patch: { active: false },
                        })
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {patch.isError && (
          <p className="mt-2 text-xs text-accent-rose">
            {patch.error instanceof Error ? patch.error.message : "Update failed."}
          </p>
        )}
      </section>

      {orphans.length > 0 && (
        <section>
          <h2 className="cap mb-2">Unknown versions in the field</h2>
          <p className="mb-2 text-xs text-ink-3">
            Devices reporting these versions through{" "}
            <code className="text-ink">/devices/heartbeat</code> aren't matched
            to any row in <code className="text-ink">firmware_releases</code>.
            Likely a hand-flashed dev build, or a release that was hard-deleted
            from the manifest.
          </p>
          <div className="overflow-hidden rounded-lg border border-line-soft">
            <table className="w-full text-sm">
              <thead className="bg-paper-2 text-left text-xs uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-3 py-2">Version</th>
                  <th className="px-3 py-2 text-right">Devices</th>
                  <th className="px-3 py-2 text-right">Alive 24h</th>
                  <th className="px-3 py-2 text-right">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {orphans.map((o) => (
                  <tr key={o.version} className="border-t border-line-soft">
                    <td className="px-3 py-2 font-mono">{o.version}</td>
                    <td className="px-3 py-2 text-right">{o.deviceCount}</td>
                    <td className="px-3 py-2 text-right">{o.aliveCount}</td>
                    <td className="px-3 py-2 text-right">
                      {fmtAgo(o.lastSeenAt, health.data!.generatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};

const ReleaseRow = ({
  release,
  health,
  busy,
  onPromote,
  onYank,
}: {
  release: FirmwareRelease;
  health: FirmwareHealthRow | null;
  busy: boolean;
  onPromote: () => void;
  onYank: () => void;
}) => {
  const [confirmYank, setConfirmYank] = useState(false);
  const sizeMb = (release.sizeBytes / (1024 * 1024)).toFixed(2);
  const stateLabel = release.active
    ? "promoted"
    : release.yankedAt
      ? "yanked"
      : "registered";
  const stateClass = release.active
    ? "bg-accent-sage/20 text-ink"
    : release.yankedAt
      ? "bg-accent-rose/20 text-ink"
      : "bg-paper-3 text-ink-2";
  return (
    <tr className="border-t border-line-soft">
      <td className="px-3 py-2 font-mono">{release.version}</td>
      <td className="px-3 py-2">
        <span className={`rounded-full px-2 py-0.5 text-xs ${stateClass}`}>
          {stateLabel}
        </span>
      </td>
      <td className="px-3 py-2 text-right">{health?.deviceCount ?? 0}</td>
      <td className="px-3 py-2 text-right">{health?.aliveCount ?? 0}</td>
      <td className="px-3 py-2 text-right">{health?.recentCount ?? 0}</td>
      <td className="px-3 py-2 text-right text-ink-2">{sizeMb} MB</td>
      <td className="px-3 py-2 text-right">
        {release.active ? (
          confirmYank ? (
            <span className="inline-flex gap-1">
              <button
                type="button"
                onClick={() => {
                  setConfirmYank(false);
                  onYank();
                }}
                disabled={busy}
                className="rounded-md bg-accent-rose px-2 py-1 text-xs text-paper hover:opacity-90 disabled:opacity-60"
              >
                Confirm yank
              </button>
              <button
                type="button"
                onClick={() => setConfirmYank(false)}
                className="rounded-md border border-line bg-paper-2 px-2 py-1 text-xs text-ink hover:border-ink"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmYank(true)}
              disabled={busy}
              className="rounded-md border border-line bg-paper-2 px-2 py-1 text-xs text-ink hover:border-ink disabled:opacity-60"
            >
              Yank
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={onPromote}
            disabled={busy}
            className="rounded-md bg-ink px-2 py-1 text-xs text-paper hover:opacity-90 disabled:opacity-60"
          >
            Promote
          </button>
        )}
      </td>
    </tr>
  );
};

const fmtAgo = (ts: number | null, nowSec: number): string => {
  if (ts === null) return "—";
  const d = nowSec - ts;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.round(d / 60)} min`;
  if (d < 86400) return `${Math.round(d / 3600)} h`;
  return `${Math.round(d / 86400)} d`;
};
