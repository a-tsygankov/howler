# Howler firmware

PlatformIO project for the CrowPanel ESP32 Rotary Display 1.28".
Three build envs:

| Env | Purpose | Command |
| --- | --- | --- |
| `crowpanel` | Real hardware build (GC9A01 driver) | `pio run -e crowpanel -t upload` |
| `simulator` | Wokwi simulator (ILI9341 substitute) | `pio run -e simulator` then `wokwi-cli` or VS Code extension |
| `native`    | Host-side Unity tests of the domain + application layers | `pio test -e native` |

Source layout follows ports & adapters:

```
src/
├── domain/        pure types, no Arduino headers
│   ├── DashboardModel.h, DashboardItem.h
│   ├── MarkDoneQueue.h, MarkDoneDraft.h
│   ├── OccurrenceList.h, Occurrence.h
│   ├── PairState.h
│   ├── ResultType.h, User.h
│   ├── Router.h, RotaryNav.h
│   ├── Settings.h, SyncWatermark.h
│   ├── TaskId.h, WifiConfig.h
│   └── MenuScreen.h
├── application/   orchestrators (no Arduino — host-testable)
│   ├── App.h/.cpp           top-level wiring
│   ├── Ports.h              all I/O interfaces
│   ├── SyncService.h/.cpp   periodic dashboard / users / result-types pull
│   ├── MarkDoneService.h/.cpp  offline-tolerant outbound execution queue
│   └── PairCoordinator.h/.cpp  pair flow: start → poll → confirm → persist
├── adapters/      concrete I/O (Arduino + LVGL)
│   ├── ArduinoClock.h, EspRandom.h
│   ├── NvsStorage.h         Preferences-backed IStorage
│   ├── RotaryInput.h        encoder + button → IInputDevice events
│   ├── WifiStation.h        scan + connect (IWifi)
│   ├── WifiNetwork.h/.cpp   HTTPS to Worker (INetwork)
│   ├── WifiPairApi.h        pair flow REST client
│   └── NoopNetwork.h        offline fallback
└── screens/       LVGL 9 UI (Arduino-only)
    ├── ScreenManager.h/.cpp display + indev bring-up, frame loop, routing
    └── screen_*.cpp         per-screen builders (boot, pair, dashboard,
                             task list/detail, result + user pickers,
                             settings (brightness, about), wifi, login QR,
                             offline notice)
```

## What boots, in order

1. `main.cpp` powers the LCD rail, brings up TFT_eSPI, instantiates
   each adapter, picks `WifiNetwork` or `NoopNetwork` based on whether
   a device token is present in NVS, then constructs `App` and
   `ScreenManager`.
2. `App::begin()` restores Settings + the MarkDone queue from NVS.
   - Token absent → router root = `Pair`, `PairCoordinator::start()` runs.
   - Token present → router root = `Dashboard`.
3. Frame loop: `App::tick` advances Sync / MarkDone / Pair services;
   `ScreenManager::tick` polls input and dispatches.
4. On a successful pair: `PairCoordinator` writes the token to NVS,
   `App::tick` sees `Confirmed` and switches the router to `Dashboard`.

## Sync model

`SyncService` polls four endpoints every `intervalMs_`:

| Source | Wire | Updated by |
| --- | --- | --- |
| Dashboard items | `GET /api/dashboard` | server-resolved urgency |
| Users | `GET /api/users` | display-name + avatar updates |
| Result types | `GET /api/task-results` | result picker config |
| Pending occurrences (legacy) | `GET /api/occurrences/pending` | back-stop feed |

Each successful round bumps the `SyncWatermark` (max `updatedAt` per
collection). The watermark is exposed for a future incremental sync
(`?since=…`) — until that endpoint lands the watermark is informational.

`MarkDoneService` handles the outbound side: any "done" press is queued
locally with a generated execution id; the queue drains on the next
online tick. The id is the server's primary key for `task_executions`,
so retries and reboots are idempotent.

## Tests

```
pio test -e native
```

Runs both Unity test runners:

- `test/test_domain/` — pure-value tests (DashboardModel cursor /
  sort, MarkDoneQueue FIFO + cap + dedupe, Router stack, RotaryNav
  wrap/clamp, ResultType snapping, OccurrenceList ordering).
- `test/test_application/` — service-level tests using in-memory stubs
  (SyncService offline + happy path, MarkDoneService persist / drain /
  retry / drop, PairCoordinator state transitions, App boot routing
  and commit-pending-done flow).

The Wokwi simulator substitutes ILI9341 for GC9A01 (Wokwi has no
GC9A01 part) and switches PSRAM from OPI to QSPI. Logic is identical;
colors are slightly off — review note for visual regressions only.
