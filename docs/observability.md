# Howler observability

Workers Analytics Engine dataset `howler_events`. Each row has
`indexes[1]`, `blobs[]` (strings), `doubles[]` (numbers).

## Enabling

The binding in `backend/wrangler.toml` is commented out by default
because Analytics Engine must be enabled on the account first:
https://dash.cloudflare.com/<account>/workers/analytics-engine

Once enabled:

```toml
[[analytics_engine_datasets]]
binding = "ANALYTICS"
dataset = "howler_events"
```

…then `wrangler deploy`. The instrumentation in
`backend/src/observability.ts` is already wired and is a no-op when
the binding is missing.

## Schema (per event kind)

The `index` is the rough event kind. Use it as the primary filter.

### `cron`

`recordCronTick(env, enqueued, durationMs)`

| field | type | meaning |
| --- | --- | --- |
| `index1` | string | `"cron"` |
| `blob1`  | string | `"cron-fanout"` |
| `double1`| number | enqueued count |
| `double2`| number | fanout duration ms |

### `fired`

`recordOccurrenceFired(env, taskId, scheduleId, dueAt, firedAtMs)`

| field | type | meaning |
| --- | --- | --- |
| `index1` | string | `"fired"` |
| `blob1`  | string | `"occurrence-fired"` |
| `blob2`  | string | task id |
| `blob3`  | string | schedule id |
| `double1`| number | cron lag in seconds (firedAt - dueAt) |

### `acked`

`recordOccurrenceAcked(env, occurrenceId, firedAtMs, ackedAtMs, byKind)`

| field | type | meaning |
| --- | --- | --- |
| `index1` | string | `"acked"` |
| `blob1`  | string | `"occurrence-acked"` |
| `blob2`  | string | occurrence id |
| `blob3`  | string | `"user"` or `"device"` |
| `double1`| number | ack latency ms (acked - fired) |

### `auth:ok` / `auth:error`

`recordAuthEvent(env, kind, result, durationMs, detail?)`

| field | type | meaning |
| --- | --- | --- |
| `index1` | string | `"auth:ok"` or `"auth:error"` |
| `blob1`  | string | `"auth"` |
| `blob2`  | string | kind (`login`, `setup`, `pair-confirm`, …) |
| `blob3`  | string | result (`ok` / `error`) |
| `blob4`  | string | error detail (when applicable) |
| `double1`| number | duration ms |

### `push:ok` / `push:error`

`recordPushDelivery(env, endpoint, status, ok)`

| field | type | meaning |
| --- | --- | --- |
| `index1` | string | `"push:ok"` or `"push:error"` |
| `blob1`  | string | `"push"` |
| `blob2`  | string | `"ok"` or `"error"` |
| `blob3`  | string | HTTP status code as string |
| `blob4`  | string | endpoint host (push provider — e.g. `fcm.googleapis.com`) |
| `double1`| number | 1 if ok else 0 |
| `double2`| number | HTTP status |

## Useful dashboard queries

Run via the dashboard's "Workers Analytics Engine → SQL" view.

### Cron lag p99 (last hour)

```sql
SELECT
  quantileWeighted(0.99)(double1, _sample_interval) AS p99_lag_sec
FROM howler_events
WHERE index1 = 'fired'
  AND timestamp > NOW() - INTERVAL '1' HOUR
```

### Ack latency p50 / p99 (last 24h)

```sql
SELECT
  quantileWeighted(0.50)(double1, _sample_interval) AS p50_ms,
  quantileWeighted(0.99)(double1, _sample_interval) AS p99_ms
FROM howler_events
WHERE index1 = 'acked'
  AND timestamp > NOW() - INTERVAL '1' DAY
```

### Auth error rate (last hour, by kind)

```sql
SELECT
  blob2 AS kind,
  countIf(blob3 = 'error') AS errors,
  count(*) AS total,
  errors / total AS error_rate
FROM howler_events
WHERE blob1 = 'auth'
  AND timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY kind
ORDER BY error_rate DESC
```

### Push delivery success per provider (last hour)

```sql
SELECT
  blob4 AS provider,
  countIf(blob2 = 'ok')    AS delivered,
  countIf(blob2 = 'error') AS failed
FROM howler_events
WHERE blob1 = 'push'
  AND timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY provider
```

### Average daily grams (per task) over the last 7 days

This one's a D1 query — `task_executions` is the per-task analytics
log (denormalized snapshot of the result type's unit).

```sql
-- in D1 (the worker's bound database, not Analytics Engine):
SELECT
  task_id,
  AVG(result_value) AS avg_grams
FROM task_executions
WHERE result_unit = 'gr'
  AND ts > strftime('%s', 'now', '-7 days')
GROUP BY task_id
ORDER BY avg_grams DESC
```

## Logpush — structured request log to R2

The backend emits one JSON line per request via `src/logger.ts`
(plus `cron-fanout`, `cron-fanout-failed`, `unhandled` events). The
shape is:

```json
{
  "ts": "2026-05-06T18:00:00.000Z",
  "level": "info",
  "msg": "request",
  "reqId": "<cf-ray>",
  "method": "POST",
  "path": "/api/auth/login",
  "status": 200,
  "durationMs": 47
}
```

Setup (one-time, dashboard):

1. Cloudflare dashboard → Workers & Pages → `howler-api` → Logs → Logpush.
2. Destination: an R2 bucket (`howler-logs` recommended, separate from
   `howler-firmware` and `howler-avatars` for ACL clarity).
3. Filters: include `workers-trace-events` (which contains
   `console.log` lines as JSON).
4. Format: NDJSON.
5. Retention: 30 days; tune from there.

Until Logpush is on, the same JSON lines are visible live via
`wrangler tail howler-api` and pretty-printed with `--format=pretty`.

## Phase 3 → 4 SLOs

These are the gates plan §18 Phase 3 → 4 references for the 7-day
demo-ready watch:

| | Target | Source |
| --- | --- | --- |
| Cron lag p99 | < 90 s | Analytics: `index1='fired'` `double1` |
| Ack latency p99 | < 500 ms | Analytics: `index1='acked'` `double1` |
| Auth error rate | < 5 % per kind | Analytics: error/total query |
| Push delivery success | > 95 % per provider | Analytics: `blob1='push'` |
| 5xx rate | < 0.5 % | Logpush: `level='error' OR status>=500` |
| Median request latency | < 250 ms | Logpush: `durationMs` percentiles |

The Phase 3 → 4 gate also requires:

1. Playwright happy paths green for 7 consecutive days on `main`.
2. No P0/P1 bugs open against the web app or API.
3. Two non-engineer testers complete the quick-setup → create →
   notification → ack flow on a phone without help.
