# Handoff: Howler — household task PWA + dial device

## Overview

Howler is a household task-reminder system: a PWA where users create
recurring tasks (feed the cat, water plants, take meds), and a small
round-screen "dial" device that surfaces the most-urgent pending task
and lets a household member ack it with a knob long-press. This
handoff package contains the visual and interaction design for the
**PWA**, plus a contract for the **device screens** (firmware UX, not
firmware code).

The product spec — schema, API, OTA, infra — lives in
`uploads/plan.md` in the originating project. **Read it alongside this
handoff.** This document is the *visual* layer; `plan.md` is the
*system* layer.

## About the design files

The files in this bundle are **design references created in HTML +
inline JSX (Babel-in-browser)**. They are *prototypes showing intended
look and behavior*, not production code to copy directly. They run
without a build step solely so reviewers could iterate; the production
target is **React 18 + Vite + TypeScript + Tailwind + shadcn/ui** as
committed in `plan.md` §8.

Your task is to **recreate these designs in that production stack**,
porting the design tokens verbatim, lifting the component composition
1:1, and replacing the inline `style={{...}}` blocks with Tailwind
classes derived from the same tokens. Where this bundle uses
`React.useState`, that maps directly. Where it uses static mock data
(`data.js`), wire in real fetched data from the backend in `plan.md`.

## Fidelity

**High-fidelity.** Final colors, type ramp, spacing, iconography,
component composition, and interaction model are all locked. Pixel
fidelity is expected — match radii, ring weights, mono-caps treatment,
and the warm-domestic palette exactly. The only thing left abstract is
photo content (we use placeholder gradients for pet photos; production
plugs in `<img src={user.uploadedPhoto}>`).

## Screens / views

### 1. Home dashboard — V1 "Day Ribbon" *(production default)*

**Purpose:** glance the day. The user opens the PWA, sees what's left
today, taps a task to ack it.

**Layout** (mobile, 390 × 844 frame):
- Header (`padding: 18px 22px 6px`): two-column flex
  - Left: caps eyebrow `Wednesday · May 6` (mono, 11px, letter-spacing
    `.12em`, `--ink-3`), then serif "5 left today" (Fraunces 500, 18px)
  - Right: 36 × 36 round avatar with initials "AX", urgency ring 0
- Progress bar (`padding: 10px 22px 12px`):
  flex row, 6px-tall track (`--paper-3`), fill `--ink`, mono "4/9" caption
- Segmented toggle: two pills "By time" / "By label". Active = ink
  background, paper text. 12px Inter Tight 500.
- Sections: when grouped By time, three groups
  (Morning 07:00–11:00, Afternoon 12:00–17:00, Evening 17:00–22:00).
  When grouped By label, one group per label (Pets / Chores /
  Personal / Work / Health), each prefixed with an 8px round color
  swatch matching `label.color`.
- Section header row: serif name (16px), mono caps hour OR nothing (label
  mode), right-aligned mono count.
- Rows (`DayRibbonRow`, 10px 22px padding, `border-top: 1px solid
  --line-soft`):
  46px-wide mono due time → 38px round `HowlerAvatar` →
  flex-1 title (15px Inter Tight 500) + secondary line (12px label color
  + optional 11px mono-caps "OVERDUE" in `--accent-rose`) → 28px round
  done button (transparent + 1.5px outline; or `--accent-sage` filled
  with check icon when done).
- Bottom tab bar (floating pill, separate component) — Today / All /
  Stats / Members / Settings.

**Components:** `HowlerAvatar`, `ProgressBar`, `SegBtn`,
`DayRibbonRow`, `BottomTabs`. All defined in `home-variants.jsx`.

**Note:** V2 (Stack), V3 (Rooms), V4 (Hearth) variants are present in
this bundle for *reference only*. **Do not implement them.** Confirmed
with the designer: V1 is production.

### 2. Task list / browse

Filterable by label pills, sortable by due. Same row treatment as the
home dashboard, slightly denser. See `secondary-screens.jsx`
(`TaskList`).

### 3. Task detail + history

Hero band tinted by the task's label color, sparkline of last-7-days
`result_value`, history list of `task_executions` with assignee
initials. Defined in `secondary-screens.jsx` (`TaskDetail`). The
sparkline is hand-rolled SVG (~30 LOC) — keep that, or swap to
Recharts if the project already uses it.

### 4. Result types manager

CRUD list. Each row shows unit, range, step, "pre-fills last value"
toggle. Per `plan.md` §6.3 #10, warn before deletion if any
`task_results` reference the type. See `ResultTypesManager` in
`secondary-screens.jsx`.

### 5. Ack flow — variant B "Slider sheet" *(locked)*

Per spec §6.5: `POST /api/occurrences/:id/ack` accepts an optional
`resultValue`. Path is **always optional** — user can skip the value.

**UI** (`AckShell` + `AckVariantB` in `ack-variants.jsx`):
- Bottom sheet overlay, drag handle, paper background, 24px radius top corners.
- Task hero: avatar + serif title + caps "DUE 08:00".
- "Last time was 50 gr by Sam" hint line (italic, `--ink-3`) — only
  shown when the task's `result_type.use_last_value = 1` AND a previous
  `task_executions.result_value` exists.
- Range slider: thumb 24px round, track 6px, fill `--accent-sage`. Live
  numeric readout in serif 28px above. Min/max/step come from the task's
  `result_type` row.
- Footer: two buttons, "Skip value" (outline) and "Mark done" (filled
  ink). Skip writes a row with `result_value = NULL`.

### 6. Desktop view

1200 × 760 baseline. Sidebar (Today / All / Stats / Members / Settings
+ Labels). Two-column "Today" main with a streak card. Reuses the
`HowlerAvatar` + done-button primitives from V1. Defined inline in
`Howler Mockups.html`. Treat as **thin baseline only** — the phone is
the primary target; ship desktop in a later milestone.

### 7. Device screens — round 240 × 240 dial

Three keyframes. Firmware (LVGL 9) implements; this bundle just
specifies the look in `device-screens.jsx`.

1. **Idle** — caps `WED · MAY 6`, large numerals `8:04`, mono `3 PENDING`.
2. **Pending** — most-urgent occurrence: round avatar centered, urgency
   ring around the screen perimeter (matches PWA `--urg-{0..3}`), mono
   `DUE 08:00 · 50 GR`.
3. **Ack arc** — long-press progress (~70 %) along the rim in
   `--accent-sage`, green check fill in center, "Hold to confirm"
   caption, footer hint `·· DOUBLE-TAP TO BACK`.

**Input model (per m0031 / m0042):**
- **Long-press (≥ 700 ms)** = activate / confirm with rim-arc fill
- **Double-tap (< 350 ms window)** = back / up one level
- **Tap** = activate selected item (when no confirmation needed)
- **Knob rotation** = move selection around the circle of items
This supersedes earlier text in `plan.md` §11; the file in this bundle
already has the corrected wording.

## Interactions & behavior

- **Tap row → open ack sheet** (slide up, 220 ms `cubic-bezier(.2,.8,.2,1)`).
- **Mark done in ack sheet → sheet collapses, row strikes through and
  fades to 55 % opacity, done button turns sage with check, then row
  removes from list on next render.** No undo for v1.
- **Skip value → same as above but POST without `resultValue`.**
- **Toggle By time / By label → instant re-group, no animation.**
- **Segmented toggle is local state**, not persisted to server. Persist
  to `localStorage` under `howler.home.groupBy`.
- **Bottom tabs**: route changes only. No transition.
- **Pull-to-refresh** on home: re-fetch `/api/occurrences?date=today`.
- **No drag-reorder**, no swipe actions in v1. Keep the surface tight.

## State management

For the home dashboard (V1):
```ts
groupBy: 'time' | 'label'   // localStorage-persisted
ackSheetTaskId: string|null // null = closed
ackValue: number            // slider-controlled, defaults to last value or median
```

Server data (per `plan.md` §6):
```ts
useTodayOccurrences()  // GET /api/occurrences?date=today
useTask(id)            // GET /api/tasks/:id (for detail)
useAck()               // POST /api/occurrences/:id/ack
useResultTypes()       // GET /api/result-types
```

Use React Query / TanStack Query.

## Design tokens

All in `styles.css`. Port verbatim into `tailwind.config.ts` under
`theme.extend`.

### Colors (warm domestic)

| Token | Value | Use |
|---|---|---|
| `--paper`   | `#F5EFE3` | App background |
| `--paper-2` | `#EDE5D4` | Subtle elevated surface |
| `--paper-3` | `#E2D8C2` | Inactive track / hairline ground |
| `--ink`     | `#2A2620` | Primary text, primary buttons |
| `--ink-2`   | `#4A4339` | Secondary text |
| `--ink-3`   | `#7A7060` | Tertiary text, mono caps |
| `--line`        | `#D5C9B0` | Borders |
| `--line-soft`   | `#E2D8C2` | Row dividers |
| `--accent-amber` | `#C58A3D` | Pets accent |
| `--accent-sage`  | `#6E8A5C` | Chores / "done" affordance |
| `--accent-plum`  | `#7A4B6E` | Personal |
| `--accent-sky`   | `#4F6E8A` | Work |
| `--accent-rose`  | `#B0586A` | Health / overdue |
| `--urg-0` | `--paper-3` | Later (no urgency) |
| `--urg-1` | `--accent-amber` | Soon |
| `--urg-2` | `--accent-rose` | Now |
| `--urg-3` | `#8E2E2E` | Overdue (deeper rose) |

### Typography

| Token | Family | Use |
|---|---|---|
| `--font-display` | `Fraunces, Georgia, serif` (500) | Screen titles, hero numerals |
| `--font-serif`   | `'Source Serif 4', Georgia, serif` | Task titles in cards |
| `--font-sans`    | `'Inter Tight', system-ui, sans-serif` | UI text, body |
| `--font-mono`    | `'JetBrains Mono', ui-monospace, monospace` | Caps labels, due times, numerics |

Caps treatment (`.cap` class): mono, 11px, `letter-spacing: .12em`,
`text-transform: uppercase`, `color: var(--ink-3)`.

### Spacing / radii / shadows

- Radii: rows have no radius; cards 14px; pill buttons 999px; sheet 24px top corners only.
- Spacing: 4 / 8 / 10 / 12 / 16 / 20 / 22px scale.
- No drop shadows except on the floating bottom-tab pill: `0 6px 24px rgba(42,38,32,.18)`.

## Avatars

Round photo + colored urgency ring (Option B from spec §13).
- Photo-backed: replace `<PhotoSilhouette>` placeholder with `<img>`
  of the user's upload.
- Initials fallback: SVG with initials on hash-determined background
  (per spec §6.3). Background colors should be from a curated set
  derived from the accent palette, not free-form.
- **Colorblind redundancy is unresolved.** Add an icon glyph or
  shape variation to the urgency ring during code review (small `!`,
  clock, etc) to satisfy §11's CVD note.

## Iconography

Three sets in `icons.jsx`. Designer kept all three for now. Per the
handoff doc, **default to Set A (hand-drawn line)** for cards and
headers, **Set B (solid)** for tab bar / FAB / very small sizes. **Do
not mix A and C in the same view.** The icon component signature is
`<Icon name size color />` — alias the import in one place to swap
sets globally.

20 names: paw, broom, heart, briefcase, pill, plant, bowl, bell, clock,
calendar, flame, star, dog, cat, home, tooth, run, book, sparkle, check,
plus, more, filter.

## Assets

- **Fonts**: Fraunces, Source Serif 4, Inter Tight, JetBrains Mono — all
  Google Fonts. Already wired in the HTML.
- **Photos**: placeholder gradients only. Production plugs in real
  user uploads (per spec §6.3 image storage).
- **Icons**: SVG inline, defined in `icons.jsx`. Tree-shake into a
  barrel when porting.
- **No images** in this bundle.

## Files in this bundle

| File | What it contains |
|---|---|
| `Howler Mockups.html` | The runnable design canvas. Open in any browser. |
| `styles.css` | Design tokens (`:root` block) + utility classes. |
| `data.js` | Mock dataset: tasks, users, labels, executions. |
| `icons.jsx` | Icon sets A / B / C + 20 category names. |
| `avatar.jsx` | `<HowlerAvatar>` — round photo + urgency ring. |
| `home-variants.jsx` | V1 (Day Ribbon — implement this), V2/V3/V4 (reference only). |
| `secondary-screens.jsx` | Task list, task detail w/ sparkline, result-types manager. |
| `ack-variants.jsx` | Variant B (Slider — implement this), A and C (reference). |
| `device-screens.jsx` | 240 × 240 dial: idle, pending, ack arc. |
| `icon-showcase.jsx` | Icon comparison panels (review-only, don't ship). |
| `design-canvas.jsx`, `ios-frame.jsx` | Canvas runtime — review-only. |
| `handoff.md` | Original designer handoff with rationale + recommendations. |

## Build-out checklist

In rough order:

1. Wire `styles.css` tokens into `tailwind.config.ts` under
   `theme.extend.colors` / `fontFamily`.
2. Port `<HowlerAvatar>` to a real component using `<img>` + the
   urgency-ring wrapper. Add CVD redundancy.
3. Build `<HomeV1>` (Day Ribbon) with the segmented toggle and
   localStorage persistence.
4. Adapt `<DayRibbonRow>` for the All-tasks tab (denser, label-pill filter).
5. Implement `<AckSheetSlider>` (variant B) generic over the task's
   `result_type` (min/max/step/unit/use_last_value).
6. Task detail + sparkline.
7. Result-types manager (with delete-warning per §6.3 #10).
8. Pick **Set A** icons, fork into a tree-shakeable barrel; do not ship
   all three sets.
9. Settings / users / devices managers — out of scope here, follow the
   same `<Phone>` framing pattern.
10. Desktop view (last; phone is primary).

## What's deferred

- Schedule template picker — covered by spec §6, not visually prototyped.
- Pair-a-device flow — already lives in dev-2 webapp per spec.
- Onboarding / first-run — follow V1 visual language.
- Accessibility audit — colors meet AA; CVD ring redundancy unresolved.
