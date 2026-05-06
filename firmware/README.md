# Howler firmware

PlatformIO project for the CrowPanel ESP32 Rotary Display 1.28".
Three build envs:

| Env | Purpose | Command |
| --- | --- | --- |
| `crowpanel` | Real hardware build (GC9A01 driver) | `pio run -e crowpanel -t upload` |
| `simulator` | Wokwi simulator (ILI9341 substitute) | `pio run -e simulator` then `wokwi-cli` or VS Code extension |
| `native`    | Host-side Unity tests of pure domain layer | `pio test -e native` |

Source layout follows ports & adapters (inherited verbatim from Feedme):

```
src/
├── domain/        pure types, no Arduino headers (TaskId.h, Occurrence.h, OccurrenceList.h, MenuScreen.h)
├── application/   orchestrators (SyncService, Ports.h)
└── adapters/      concrete I/O (ArduinoClock, WifiNetwork, NoopNetwork, …)
```

Native tests live in `test/test_domain/` and build the `domain/` layer
only — no Arduino/LVGL dependencies. See plan §15 HIL-1.

The Wokwi simulator substitutes ILI9341 for GC9A01 (Wokwi has no
GC9A01 part) and switches PSRAM from OPI to QSPI. Logic is identical;
colors are slightly off — review note for visual regressions only.
