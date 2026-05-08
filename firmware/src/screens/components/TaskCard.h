#pragma once

// Shared "task card" widgets used by Dashboard + TaskList — both
// driven by the design handoff in design_handoff_howler/.
//
//  Detail   — 58 px horizontal banner: status-arc avatar (icon disc
//             with urgency-tinted ring) + title block (display font
//             title + mono "4H LATE" caption) + black check button.
//             Sits in the centre slot of the DrumScroller; tap →
//             mark-done flow.
//
//  Mini     — 26 px row: 20 px status-arc avatar + truncated title
//             + mono due chip ("2H LATE" / "IN 1H" / "TODAY"). Sits
//             in neighbour slots above and below the detail card.
//             The drum's per-distance layout shrinks the slot width
//             and dims the slot opacity to give the "peek-stack"
//             depth cue (closer minis flush, farther minis inset
//             and partially overlapped).
//
// All builders are pure — no state, no event callbacks. The owning
// screen routes taps via ScreenManager's centralised dispatch.

#include "RoundCard.h"
#include "../../domain/DashboardItem.h"

#include <Arduino.h>
#include <lvgl.h>
#include <ctype.h>
#include <stdio.h>
#include <vector>

namespace howler::screens::components {

// ─── Urgency tier (0..3) — design vocabulary ─────────────────────
//
// The handoff names four tiers (idle / soon / late / very-late) with
// dedicated tones (sand / amber / ochre / terracotta). Our domain
// has 3-state Urgency + an isMissed overlay; this maps:
//   isMissed                 → 3 (very late, terracotta)
//   Urgency::Urgent          → 2 (late,      ochre)
//   Urgency::NonUrgent       → 1 (soon,      amber)
//   Urgency::Hidden          → 0 (idle,      sand)
//
// The ring around the avatar fills proportionally to the tier — full
// muted ring at idle, partial at soon, mostly-full at late, near-
// closed at very-late — so urgency reads at a glance even from the
// edge of the disc where text is too small to parse.

inline int designUrgencyTier(const domain::DashboardItem& item) {
    if (item.isMissed) return 3;
    switch (item.urgency) {
        case domain::Urgency::Urgent:    return 2;
        case domain::Urgency::NonUrgent: return 1;
        case domain::Urgency::Hidden:    return 0;
    }
    return 0;
}

inline lv_color_t urgencyTone(int tier) {
    switch (tier) {
        case 0: return lv_color_make(0xB7, 0xA9, 0x8A);  // sand
        case 1: return lv_color_make(0xC9, 0xA8, 0x62);  // amber
        case 2: return lv_color_make(0xC7, 0x7A, 0x2A);  // ochre
        case 3: return lv_color_make(0xB2, 0x5A, 0x55);  // terracotta
    }
    return lv_color_make(0xB7, 0xA9, 0x8A);
}

/// Fill fraction (0.0 .. 1.0) of the status-arc ring for a tier.
/// Per the design handoff: idle = full muted ring, soon = ~40 %
/// arc, late = ~66 %, very late = ~85 %. Returned as a 0..360
/// degree sweep so callers can plug straight into lv_arc_set_angles.
inline int urgencyFillDegrees(int tier) {
    switch (tier) {
        case 0: return 360;
        case 1: return 144;   // ~ 0.40 × 360
        case 2: return 238;   // ~ 0.66 × 360
        case 3: return 306;   // ~ 0.85 × 360
    }
    return 360;
}

inline const char* urgencyCaption(int tier) {
    switch (tier) {
        case 0: return "IDLE";
        case 1: return "SOON";
        case 2: return "LATE";
        case 3: return "MISSED";
    }
    return "";
}

// ─── Due-time formatting — design's "2H LATE" / "IN 1H" chip ─────
//
// Returns a pointer to a per-call static buffer; copy out before the
// next invocation if you need to compare multiple values. Returns
// "TODAY" when the due is set but the relative window is too small
// to be interesting (< 5 min in either direction). Returns "" when
// dueAt is unset (negative) so the caller can omit the chip entirely.
inline const char* taskDueChip(int64_t dueAt, int64_t serverNowSec,
                               bool missed) {
    static char buf[16];
    if (missed) return "MISSED";
    if (dueAt < 0) return "";
    if (serverNowSec <= 0) return "TODAY";
    const int64_t delta = dueAt - serverNowSec;
    const int64_t abs   = delta < 0 ? -delta : delta;
    if (abs < 300) return "TODAY";  // < 5 min either way
    const int64_t hours = abs / 3600;
    const int64_t mins  = (abs / 60) % 60;
    if (delta < 0) {
        if (hours > 0) snprintf(buf, sizeof(buf), "%lldH LATE",
                                (long long)hours);
        else           snprintf(buf, sizeof(buf), "%lldM LATE",
                                (long long)mins);
    } else {
        if (hours > 0) snprintf(buf, sizeof(buf), "IN %lldH",
                                (long long)hours);
        else           snprintf(buf, sizeof(buf), "IN %lldM",
                                (long long)mins);
    }
    return buf;
}

// ─── Avatar inner content — icon glyph or initials ───────────────
//
// Pull the LVGL icon name out of a DashboardItem.avatarId. Avatar IDs
// of the form "icon:name" carry the icon-set choice (mirroring the
// webapp's `LABEL_ICON_CHOICES`); for explicit uploaded avatars
// (regular UUIDs) we fall back to the title's initials. Returns
// nullptr when no usable icon name can be derived.
inline const char* iconKeyFromAvatar(const std::string& avatarId) {
    constexpr const char* kPrefix = "icon:";
    if (avatarId.size() <= 5) return nullptr;
    if (avatarId.compare(0, 5, kPrefix) != 0) return nullptr;
    static char name[32];
    const auto rest = avatarId.substr(5);
    snprintf(name, sizeof(name), "%s", rest.c_str());
    return name;
}

/// Render the badge content for a given icon name. LVGL's built-in
/// font carries a small FontAwesome subset (LV_SYMBOL_*); names that
/// match a built-in symbol render as the actual glyph, the rest fall
/// back to a deterministic two-letter code so each Lucide name on
/// the webapp side maps to a recognisable badge on the device. This
/// is the placeholder until a custom Lucide-PNG-to-LVGL-font asset
/// lands; the two-letter code is stable enough that users can pick
/// up the convention quickly (PA = paw, BR = broom, BK = book, etc.).
inline const char* badgeTextForIcon(const char* iconKey) {
    if (!iconKey) return "?";
    const std::string n = iconKey;
    // Direct LVGL symbol matches.
    if (n == "home")     return LV_SYMBOL_HOME;
    if (n == "bell")     return LV_SYMBOL_BELL;
    if (n == "check")    return LV_SYMBOL_OK;
    if (n == "calendar") return LV_SYMBOL_DIRECTORY;
    // Two-letter codes for everything else. Order: most-distinctive
    // first letter, then a follow-up that disambiguates from siblings
    // sharing the leading letter (broom vs. book, paw vs. plant/pill,
    // etc.). Keep the table in sync with webapp LABEL_ICON_CHOICES.
    if (n == "paw")       return "PA";
    if (n == "dog")       return "DG";
    if (n == "cat")       return "CT";
    if (n == "broom")     return "BR";
    if (n == "bowl")      return "BL";
    if (n == "heart")     return "HT";
    if (n == "sparkle")   return "SP";
    if (n == "star")      return "ST";
    if (n == "plant")     return "PL";
    if (n == "flame")     return "FL";
    if (n == "briefcase") return "BC";
    if (n == "book")      return "BK";
    if (n == "run")       return "RN";
    if (n == "pill")      return "PI";
    if (n == "tooth")     return "TT";
    if (n == "clock")     return "CK";
    static char fb[3];
    fb[0] = static_cast<char>(toupper(static_cast<unsigned char>(n[0])));
    fb[1] = n.size() > 1
        ? static_cast<char>(toupper(static_cast<unsigned char>(n[1]))) : 0;
    fb[2] = 0;
    return fb;
}

/// Take the first 1-2 letters of `s`, uppercased. Used for the
/// fallback initials when the avatarId isn't an icon ref and we
/// still want something recognisable inside the disc.
inline const char* taskInitials(const std::string& title) {
    static char init[3];
    init[0] = '?';
    init[1] = 0;
    init[2] = 0;
    size_t i = 0;
    int written = 0;
    while (i < title.size() && written < 2) {
        const unsigned char c = static_cast<unsigned char>(title[i]);
        if (isalnum(c)) {
            init[written++] = static_cast<char>(toupper(c));
            // Advance past the rest of this word so we get the first
            // letter of word 2 next, not the second letter of word 1
            // (better for two-word titles like "feed mochi" → "FM").
            ++i;
            while (i < title.size() && isalnum(
                static_cast<unsigned char>(title[i]))) ++i;
        } else {
            ++i;
        }
    }
    init[written] = 0;
    if (written == 0) { init[0] = '?'; init[1] = 0; }
    return init;
}

// ─── Status-arc avatar ───────────────────────────────────────────
//
// Round disc with an LVGL arc ring around its perimeter. The ring's
// FILLED arc spans `urgencyFillDegrees(tier)` from 12 o'clock going
// clockwise; the unfilled portion paints in `lineSoft` so the ring
// always reads as a complete ring, just lit-vs-unlit. The inner disc
// holds either an icon glyph (when avatarId is "icon:foo") or the
// task's two-letter initials.
//
// `size` is the outer diameter (ring included). `ringWidth` is the
// stroke; the inner disc inset is ringWidth + 1 px on every side.
//
// The arc widget is placed via LV_ALIGN_CENTER on its parent slot —
// callers position the slot, this builder doesn't move itself.
inline lv_obj_t* buildStatusAvatar(lv_obj_t* parent,
                                   const domain::DashboardItem& item,
                                   int size,
                                   int ringWidth = 3) {
    const int tier = designUrgencyTier(item);
    const lv_color_t tone = urgencyTone(tier);
    const int fillDeg = urgencyFillDegrees(tier);

    auto* wrap = lv_obj_create(parent);
    lv_obj_set_size(wrap, size, size);
    lv_obj_align(wrap, LV_ALIGN_CENTER, 0, 0);
    lv_obj_clear_flag(wrap, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_bg_opa(wrap, LV_OPA_0, 0);
    lv_obj_set_style_border_width(wrap, 0, 0);
    lv_obj_set_style_pad_all(wrap, 0, 0);

    // The arc widget renders both the muted track and the urgency-
    // tinted indicator. We anchor 12 o'clock and sweep clockwise, to
    // match the design's "starts at top, fills clockwise as urgency
    // climbs" convention.
    auto* arc = lv_arc_create(wrap);
    lv_obj_set_size(arc, size, size);
    lv_obj_center(arc);
    lv_arc_set_rotation(arc, 270);                // 0° = 12 o'clock
    lv_arc_set_bg_angles(arc, 0, 360);            // full track
    lv_arc_set_angles(arc, 0, fillDeg);           // filled portion
    lv_arc_set_value(arc, 0);
    lv_obj_remove_style(arc, nullptr, LV_PART_KNOB);
    lv_obj_clear_flag(arc, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_arc_width(arc, ringWidth, LV_PART_MAIN);
    lv_obj_set_style_arc_width(arc, ringWidth, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(arc, Palette::lineSoft(), LV_PART_MAIN);
    lv_obj_set_style_arc_color(arc, tone, LV_PART_INDICATOR);
    lv_obj_set_style_arc_rounded(arc, true, LV_PART_INDICATOR);
    // Hide the arc's own background so the disc behind shines through
    // — only the stroke ring should be visible.
    lv_obj_set_style_bg_opa(arc, LV_OPA_0, 0);
    lv_obj_set_style_border_width(arc, 0, 0);
    lv_obj_set_style_pad_all(arc, 0, 0);

    // Inner disc — the avatar surface itself. Inset by ringWidth + 1
    // so the ring has a 1 px breathing gap to the disc edge.
    const int innerInset = ringWidth + 1;
    const int innerSize  = size - 2 * innerInset;
    auto* disc = lv_obj_create(wrap);
    lv_obj_set_size(disc, innerSize, innerSize);
    lv_obj_align(disc, LV_ALIGN_CENTER, 0, 0);
    lv_obj_clear_flag(disc, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_clear_flag(disc, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_radius(disc, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(disc, Palette::paper3(), 0);
    lv_obj_set_style_border_width(disc, 0, 0);
    lv_obj_set_style_pad_all(disc, 0, 0);

    // Inner glyph — icon name → FontAwesome / 2-letter code, or the
    // title's initials when the avatarId isn't an icon reference.
    const char* iconKey = iconKeyFromAvatar(item.avatarId);
    const char* glyph   = iconKey ? badgeTextForIcon(iconKey)
                                   : taskInitials(item.title);
    auto* lbl = lv_label_create(disc);
    lv_label_set_text(lbl, glyph);
    lv_obj_set_style_text_color(lbl, Palette::ink(), 0);
    // Pick a font that fits the disc — 22 for the 42-px detail
    // avatar, 18 for the 32-px transitional sizes, 14 for everything
    // smaller (mini at 20 px).
    const lv_font_t* font = (innerSize >= 32) ? &lv_font_montserrat_22
                          : (innerSize >= 22) ? &lv_font_montserrat_18
                                              : &lv_font_montserrat_14;
    lv_obj_set_style_text_font(lbl, font, 0);
    lv_obj_center(lbl);

    return wrap;
}

// ─── Detail card — 58 px horizontal banner ───────────────────────
//
// Built INTO the parent slot via LV_ALIGN_CENTER (the slot is sized
// by DrumScroller; we just fill it). Layout, left → right:
//   • 42 px status-arc avatar (urgency-coloured ring + icon disc)
//   • title block: title (display-style font, 1 line, ellipsis on
//     overflow) + status row (6 px tone dot + mono caption like
//     "4H LATE")
//   • 24 px black check button (LV_SYMBOL_OK in paper colour)
//
// The card border is 1 px in the urgency tone for tier ≥ 1, soft
// line otherwise, so even from across the room you can see whether
// "this thing is urgent". Background = paper2.
inline lv_obj_t* buildDetailedTaskCard(
    lv_obj_t* parent,
    const domain::DashboardItem& item,
    int64_t serverNowSec) {
    const int tier = designUrgencyTier(item);
    const lv_color_t tone = urgencyTone(tier);

    auto* card = lv_obj_create(parent);
    lv_obj_set_size(card, lv_obj_get_width(parent) - 4, 58);
    lv_obj_align(card, LV_ALIGN_CENTER, 0, 0);
    lv_obj_clear_flag(card, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_radius(card, 16, 0);
    lv_obj_set_style_bg_color(card, Palette::paper2(), 0);
    lv_obj_set_style_border_color(card,
        tier >= 1 ? tone : Palette::lineSoft(), 0);
    lv_obj_set_style_border_width(card, tier >= 2 ? 2 : 1, 0);
    lv_obj_set_style_pad_left(card, 8, 0);
    lv_obj_set_style_pad_right(card, 8, 0);
    lv_obj_set_style_pad_top(card, 6, 0);
    lv_obj_set_style_pad_bottom(card, 6, 0);

    // Avatar — fixed at the left edge of the card. 42 px outer with
    // a 3 px ring; inner disc holds the icon / initials.
    auto* avatar = buildStatusAvatar(card, item, /*size=*/42, /*ring=*/3);
    lv_obj_align(avatar, LV_ALIGN_LEFT_MID, 4, 0);

    // Check button — 24 px black disc on the right; LV_SYMBOL_OK
    // glyph centred. Tap routing happens at the slot level via
    // DrumScroller's CLICKED handler / ScreenManager fireActivate,
    // not here — this is a visual affordance.
    auto* check = lv_obj_create(card);
    lv_obj_set_size(check, 24, 24);
    lv_obj_align(check, LV_ALIGN_RIGHT_MID, -4, 0);
    lv_obj_clear_flag(check, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_clear_flag(check, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_radius(check, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(check, Palette::ink(), 0);
    lv_obj_set_style_border_width(check, 0, 0);
    lv_obj_set_style_pad_all(check, 0, 0);
    auto* checkGlyph = lv_label_create(check);
    lv_label_set_text(checkGlyph, LV_SYMBOL_OK);
    lv_obj_set_style_text_color(checkGlyph, Palette::paper(), 0);
    lv_obj_set_style_text_font(checkGlyph, &lv_font_montserrat_14, 0);
    lv_obj_center(checkGlyph);

    // Title block — fills the gap between avatar and check button.
    // Two stacked labels: serif-style title (we use montserrat_18 as
    // the closest 18 px option in the embedded font set) and a mono-
    // ish status row.
    const int blockW = lv_obj_get_width(card) - 16 - 42 - 8 - 24 - 8;
    auto* block = lv_obj_create(card);
    lv_obj_set_size(block, blockW > 60 ? blockW : 60, 44);
    lv_obj_align(block, LV_ALIGN_LEFT_MID, 4 + 42 + 8, 0);
    lv_obj_clear_flag(block, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_clear_flag(block, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_bg_opa(block, LV_OPA_0, 0);
    lv_obj_set_style_border_width(block, 0, 0);
    lv_obj_set_style_pad_all(block, 0, 0);

    auto* title = lv_label_create(block);
    lv_label_set_long_mode(title, LV_LABEL_LONG_DOT);
    lv_obj_set_width(title, lv_obj_get_width(block));
    lv_label_set_text(title, item.title.empty()
                              ? "(untitled)" : item.title.c_str());
    lv_obj_set_style_text_color(title, Palette::ink(), 0);
    lv_obj_set_style_text_font(title, &lv_font_montserrat_18, 0);
    lv_obj_align(title, LV_ALIGN_TOP_LEFT, 0, 0);

    auto* statusRow = lv_obj_create(block);
    lv_obj_set_size(statusRow, lv_obj_get_width(block), 12);
    lv_obj_align(statusRow, LV_ALIGN_BOTTOM_LEFT, 0, 0);
    lv_obj_clear_flag(statusRow, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_clear_flag(statusRow, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_bg_opa(statusRow, LV_OPA_0, 0);
    lv_obj_set_style_border_width(statusRow, 0, 0);
    lv_obj_set_style_pad_all(statusRow, 0, 0);

    // 6 px urgency-tone dot + mono caption "4H LATE · 50 GR" (we
    // omit the result-value half today; the dashboard payload
    // doesn't carry the last-execution value at row level — the
    // ResultPicker fetches that on tap).
    auto* dot = lv_obj_create(statusRow);
    lv_obj_set_size(dot, 6, 6);
    lv_obj_align(dot, LV_ALIGN_LEFT_MID, 0, 0);
    lv_obj_clear_flag(dot, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_clear_flag(dot, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_radius(dot, 3, 0);
    lv_obj_set_style_bg_color(dot, tone, 0);
    lv_obj_set_style_border_width(dot, 0, 0);
    lv_obj_set_style_pad_all(dot, 0, 0);

    auto* caption = lv_label_create(statusRow);
    char buf[32];
    const char* due = taskDueChip(item.dueAt, serverNowSec, item.isMissed);
    if (due[0] != 0) {
        snprintf(buf, sizeof(buf), "%s  %s",
                 urgencyCaption(tier), due);
    } else {
        snprintf(buf, sizeof(buf), "%s", urgencyCaption(tier));
    }
    lv_label_set_text(caption, buf);
    lv_obj_set_style_text_color(caption, tone, 0);
    lv_obj_set_style_text_font(caption, &lv_font_montserrat_14, 0);
    lv_obj_align(caption, LV_ALIGN_LEFT_MID, 10, 0);

    return card;
}

// ─── Mini row — 26 px peek-stack neighbour ───────────────────────
//
// Built INTO the parent slot. The slot's width is set per-distance
// by DrumScroller (closer = wider, farther = narrower), so this
// builder just fills the slot horizontally. Layout:
//   • 20 px status-arc avatar
//   • truncated title in ink
//   • mono due chip ("2H LATE" / "IN 1H" / "TODAY") in urgency tone
//
// `yOffset` is honoured for legacy callers that still position the
// pill manually; new (drum-driven) callers pass 0.
inline lv_obj_t* buildMiniTaskCard(
    lv_obj_t* parent,
    const domain::DashboardItem& item,
    int yOffset,
    int64_t serverNowSec) {
    const int tier = designUrgencyTier(item);
    const lv_color_t tone = urgencyTone(tier);

    auto* row = lv_obj_create(parent);
    const int parentW = lv_obj_get_width(parent);
    lv_obj_set_size(row, parentW > 0 ? parentW - 4 : 168, 26);
    lv_obj_align(row, LV_ALIGN_CENTER, 0, yOffset);
    lv_obj_clear_flag(row, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_radius(row, 10, 0);
    lv_obj_set_style_bg_color(row, Palette::paper2(), 0);
    lv_obj_set_style_border_color(row, Palette::lineSoft(), 0);
    lv_obj_set_style_border_width(row, 1, 0);
    lv_obj_set_style_pad_left(row, 4, 0);
    lv_obj_set_style_pad_right(row, 6, 0);
    lv_obj_set_style_pad_top(row, 0, 0);
    lv_obj_set_style_pad_bottom(row, 0, 0);

    // 20 px status-arc avatar at the left. Ring width 2 px reads
    // cleaner at this size than the detail-card 3 px would.
    auto* avatar = buildStatusAvatar(row, item, /*size=*/20, /*ring=*/2);
    lv_obj_align(avatar, LV_ALIGN_LEFT_MID, 2, 0);

    // Due chip — fixed-ish width on the right. Empty for tasks
    // without a due time, in which case the title just flows wider.
    const char* due = taskDueChip(item.dueAt, serverNowSec, item.isMissed);
    int dueW = 0;
    if (due[0] != 0) {
        auto* chip = lv_label_create(row);
        lv_label_set_text(chip, due);
        lv_obj_set_style_text_color(chip, tone, 0);
        lv_obj_set_style_text_font(chip, &lv_font_montserrat_14, 0);
        lv_obj_align(chip, LV_ALIGN_RIGHT_MID, -2, 0);
        // Approximate width: ~7 px per char in 14-pt mono. Used to
        // reserve space for the title's right edge so the chip
        // doesn't get clobbered by an over-wide title.
        dueW = static_cast<int>(strlen(due)) * 7 + 4;
    }

    auto* title = lv_label_create(row);
    lv_label_set_text(title, item.title.empty()
                              ? "(untitled)" : item.title.c_str());
    lv_label_set_long_mode(title, LV_LABEL_LONG_DOT);
    const int titleW = lv_obj_get_width(row) - 8 - 20 - 6 - dueW - 4;
    lv_obj_set_width(title, titleW > 30 ? titleW : 30);
    lv_obj_set_style_text_color(title, Palette::ink(), 0);
    lv_obj_set_style_text_font(title, &lv_font_montserrat_14, 0);
    lv_obj_align(title, LV_ALIGN_LEFT_MID, 2 + 20 + 6, 0);

    return row;
}

/// Convenience overload: legacy callers that don't carry a server-
/// now timestamp (the scroll-overlay screens pre-dating dev-22 still
/// call this signature). Drops the due chip's relative-time text in
/// favour of a static "TODAY" — fine for the throwaway use cases.
inline lv_obj_t* buildMiniTaskCard(
    lv_obj_t* parent,
    const domain::DashboardItem& item,
    int yOffset) {
    return buildMiniTaskCard(parent, item, yOffset, /*serverNowSec=*/0);
}

// ─── DrumScroller render helper — picks detail vs mini per tier ──
//
// The drum positions slots; this helper fills each slot with the
// right card flavour. Tier 0 → detail card; tiers ±1 / ±2 / ±3 →
// mini row. The slot's per-distance width inset (set on the drum
// via setTierLayoutByDistance) shrinks the visible mini horizontally
// for the "peek-stack" depth effect.
inline void renderTaskInDrumSlot(lv_obj_t* slot,
                                 const domain::DashboardItem& item,
                                 int tier,
                                 int64_t serverNowSec) {
    if (tier == 0) {
        buildDetailedTaskCard(slot, item, serverNowSec);
    } else {
        buildMiniTaskCard(slot, item, /*yOffset=*/0, serverNowSec);
    }
}

// ─── Tier-counts header — three small pills at the top ──────────
//
// Counts how many of the source list fall into each urgency tier.
// Empty pills (count == 0) collapse out so the header stays clean
// when the home is healthy. Caller decides whether to render this
// header at all.
struct TierCounts { size_t urgent; size_t soon; size_t hidden; };

inline TierCounts countTiers(const std::vector<domain::DashboardItem>& items) {
    TierCounts c{0, 0, 0};
    for (const auto& it : items) {
        if (it.urgency == domain::Urgency::Urgent || it.isMissed) ++c.urgent;
        else if (it.urgency == domain::Urgency::NonUrgent) ++c.soon;
        else ++c.hidden;
    }
    return c;
}

}  // namespace howler::screens::components
