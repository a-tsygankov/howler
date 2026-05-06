# Howler — Design Handoff

> Single-page mockup deliverable for the Howler PWA + small dial device.
> Read this alongside `Howler Mockups.html` (open in any browser).

---

## What's in the box

```
howler-design/
├── Howler Mockups.html       # the main, self-contained design canvas
├── styles.css                # design tokens (paper / ink / accents / type)
├── data.js                   # mock dataset (tasks, users, labels, executions)
├── icons.jsx                 # 3 icon sets (A: line, B: solid, C: editorial)
├── avatar.jsx                # round avatar w/ urgency ring (Option B)
├── home-variants.jsx         # V1 Day Ribbon · V2 Stack · V3 Rooms · V4 Hearth
├── secondary-screens.jsx     # task list · task detail · result types manager
├── ack-variants.jsx          # 3 ack-with-resultValue UIs
├── device-screens.jsx        # round 240×240 dial: idle, pending, ack arc
├── icon-showcase.jsx         # icon panels
├── design-canvas.jsx         # pan/zoom canvas runtime
└── ios-frame.jsx             # (kept for future use; not currently mounted)
```

Open `Howler Mockups.html` directly. No build step. Everything is loaded
via Babel-in-browser; pin versions are already wired.

---

## Aesthetic direction — locked

**Warm domestic.** Cream paper (`#F5EFE3`), ink charcoal (`#2A2620`),
low-chroma accents in oklch-like space (amber, sage, plum, sky, rose).
No bright primary blues, no gradients beyond the very subtle hero
treatments, no playful illustration. The feel is "kitchen counter
checklist", not "productivity SaaS".

Type pairing:
- **Display / serif:** Fraunces 500 — for screen titles, hero numbers
- **Serif body emphasis:** Source Serif 4 — for task titles in cards
- **Sans:** Inter Tight — UI text, labels, body
- **Mono:** JetBrains Mono — caps labels, due-times, small data

Tokens live in `styles.css` (`:root` block). Bring them across into
the real Tailwind theme verbatim. The `--urg-{0..3}` ring colors are
the canonical "urgency tint" set; keep them in sync with the device
firmware's color enum.

---

## Home dashboard — 4 layout variants

All show the same data state (Wed May 6, 9 tasks, 4 done). Pick one
or mix. They're not progressive iterations; they're three different
hierarchies + a hero-card option.

| Variant | Hierarchy | Visual style | When it wins |
|---|---|---|---|
| **V1 — Day Ribbon** | Time-of-day (Morning / Afternoon / Evening) | Minimal-utility, list, mono timestamps | High-volume households where you scan by hour |
| **V2 — Stack** | Urgency (overdue → later) | Warm, card, hero-first | The "default phone glance" — biggest, calmest first impression |
| **V3 — Rooms** | Label / room (Pets, Chores, Personal…) | Dense list, color-tinted section bands | Multi-pet / multi-domain users; favors browsing |
| **V4 — Hearth** | Urgency, hero card | Playful warm, hero + 2-col grid | When 1 task dominates each morning (cat feeding etc) |

**Recommendation:** ship **V2 (Stack)** as the default, with V1 (Day
Ribbon) reachable as a "by time" view toggle. V3 belongs on the "All
tasks" tab anyway. V4 is fun but only sustains attention if there's
genuinely one always-most-urgent task.

### Cross-variant primitives (already extracted, in `home-variants.jsx`)
- `<HowlerAvatar photo|initials urgency size>` — round photo or initials with the urgency ring
- `<LabelChip lbl>` — tinted pill
- `<AssigneeStack ids size>` — stacked round initials
- `<DoneButton hero>` — black circle with check
- `<BottomTabs active>` — floating pill nav

---

## Avatars — Option B locked, two flavors

Per spec §13: round photo + colored urgency ring. Two paths in the
mockup data:

- **Photo-backed** (`photo: 'mochi' | 'fern' | 'dog'`) — placeholder
  gradient + minimal subject hint. In production, replace
  `<PhotoSilhouette>` with a real `<img>` of the user's upload.
- **Initials** — for tasks without a photo (most chores, abstract
  habits). Generated from `task.initials` or first character of
  title. Server-side: per spec §6.3 default avatars are
  SVG-with-initials on a hash-determined background.

**Urgency ring** (the colored band around the round image): tones
defined in `:root` as `--urg-0..3`. Colorblind redundancy is **not**
yet baked in — to address §11's CVD note, layer either a small icon
(`!`, `!!`, clock) or a shape variation on the ring. I left this for
the implementation pass.

---

## Iconography — three sets, pick one

`Howler Mockups.html` shows three full sets of the same 20 category
symbols (paw, broom, heart, briefcase, pill, plant, bowl, bell, clock,
calendar, flame, star, dog, cat, home, tooth, run, book, sparkle, check,
plus, more, filter).

| Set | Style | Strokes | Weight at 16px | Use when |
|---|---|---|---|---|
| **A — Hand-drawn line** *(default)* | Organic, slight irregularity | 1.7 | Good | Card UI, headers, label chips |
| **B — Solid friendly** | Filled geometric | n/a (fill) | Excellent | Tab bars, buttons, very small sizes |
| **C — Editorial mark** | Square-cap thin line | 1.2 | Borderline at 12px | Dense tables, settings rows |

**Recommendation:** Set A as primary, Set B as the *small-size /
high-emphasis* fallback (tab bar, FAB, ack confirmation). Don't mix
A+C in the same view.

The icon component signature is already `<Icon name size color>` —
swap the implementation by aliasing the import in one place
(`window.HOWLER_ICONS.IconA → IconB`).

---

## Ack flow with resultValue — 3 explorations

Per spec §6.5: `POST /api/occurrences/:id/ack` accepts an optional
`resultValue`. A user "always optional" path — they can mark done
without entering a number.

| Variant | UI | Best for |
|---|---|---|
| **A — Stepper modal** | Big number + ± buttons + 4 chip presets | Discrete units (grams, count) where typical answer is one of 3–4 values |
| **B — Slider sheet** | Range slider + "last time was 50gr by Sam" hint | Continuous-feeling values, encourages last-value reuse |
| **C — Wheel picker** | iOS-style scrolling wheel | When max/step is well-defined; feels familiar on mobile |

All three share the same `<AckShell>` (sheet overlay, drag handle,
Skip-value + Mark-done footer). Skip writes a `task_executions` row
with `result_value = NULL`.

**Recommendation:** **B (slider)** for the default. The "last time"
hint matches `taskResults.useLastValue = 1` semantics directly, and
slider tolerates fuzzy inputs better than a stepper. Reserve C for
rating (1–5 stars) where exact tap-to-value is what users want.

---

## Secondary screens

- **Task list / browse** — filterable by label pills, sortable by
  due. Same row treatment as the dashboard, slightly denser.
- **Task detail + history** — hero band tinted by label color, sparkline
  of last-7-days values, history list of `task_executions`.
- **Result types manager** — list of the 5 seeded types + room for
  custom ones. Each row shows unit, range, step, "pre-fills last".

---

## Desktop view

A single 1200×760 frame with sidebar (Today / All / Stats / Members /
Settings + Labels) and a two-column "Today" main with a streak card.
The card grid reuses the same `HowlerAvatar` + done-button primitives
as the phone — confirm that nothing about V2's vocabulary breaks
when scaled up.

This is intentionally a thin baseline. The phone is the primary
target; the desktop is "doesn't break". Productionize after the
phone V2 is shipped.

---

## Device screens — round 240×240 dial

Three keyframes from spec §11's contract:

1. **Idle** — `WED · MAY 6` cap, 8:04 large numerals, `3 PENDING` mono.
2. **Pending** — most-urgent occurrence as a round avatar centered,
   urgency-ring around the screen perimeter, mono "DUE 08:00 · 50 GR".
3. **Ack arc** — long-press progress (~70%) along the rim in sage,
   green check fill in center, "Hold to confirm" caption.

The control region (long-press arc, scrolling label, knob hint) is
implicit in these — the firmware will compose them with the info
view. Pin map / TFT_eSPI flags / LVGL 9 picks already settled in the
plan; nothing here changes that.

---

## Tech stack handoff (per `plan.md` §8)

These designs commit to:
- **React 18 + Vite + TypeScript** PWA, **Tailwind + shadcn/ui** in production
- **Inter Tight** + **Fraunces** + **Source Serif 4** + **JetBrains Mono** as web fonts (Google Fonts already wired here)
- **Cloudflare Pages** for the SPA, **Workers + Hono** for the API (out of scope for design)
- **Round photo + urgency ring** avatar treatment ("Option B")

Any deviation from these picks invalidates parts of the design — flag
back if pivoting.

---

## Device — input convention

Per user direction (m0031), **double-tap = "back / up one level"**;
long-press is reserved for activate / confirm with the rim-arc fill.
Reflected in `device-screens.jsx` (DialAckArc footer hint) and
`uploads/plan.md` §11. Update the firmware encoder-button adapter
to debounce taps with a 350 ms double-tap window.

## V1 home — switchable grouping

V1 now toggles between **By time** (Morning / Afternoon / Evening)
and **By label** (Pets / Chores / …) via a segmented control under
the progress bar. Header dropped the "Good morning, Alex" line in
favor of date + small status, and gained the user-avatar treatment
from V2/V4.



In rough order:

1. Wire the design tokens in `styles.css` into `tailwind.config.ts`
   under `theme.extend.colors` / `fontFamily`.
2. Port `<HowlerAvatar>` to a real component using `<img>` + the
   urgency-ring wrapper.
3. Build `<DashboardV2>` (Stack) — drives 80% of the rest.
4. Adapt `<TaskListRow>` / `<RoomRow>` from `home-variants.jsx` for
   the All-tasks tab.
5. Implement `<AckSheetSlider>` (variant B); make it generic over the
   `task_results` row (min/max/step/unit/useLast).
6. Task detail + sparkline — use `recharts` or roll the same SVG
   inline approach for now (it's already 30 lines).
7. Result-types manager — straight CRUD. Mind the spec §6.3 #10
   warning before deletion.
8. Icons: pick **Set A**, fork into a tree-shakeable barrel. Don't
   ship all three.
9. Settings / users / devices managers — out of scope here, follow
   the same `<Phone>` framing pattern.

---

## What I deferred

- **Schedule template picker** — covered by spec §6 but not visually
  prototyped. Reuses the same chip/list vocabulary.
- **Pair-a-device flow** — confirmed already lives in the dev-2 webapp
  per `handoff.md`; no need to redesign.
- **Onboarding / first-run** — should follow the V2 visual language
  but specific screens weren't requested.
- **Accessibility audit** — colors meet AA against cream paper but
  the urgency-ring CVD problem (§13) is unresolved. Add icon glyph
  redundancy in code review.
