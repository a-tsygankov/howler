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

#include "MarqueeLabel.h"
#include "RoundCard.h"
#include "../../domain/DashboardItem.h"

#include <Arduino.h>
#include <functional>
#include <lvgl.h>
#include <ctype.h>
#include <stdio.h>
#include <string>
#include <vector>

namespace howler::screens::components {

/// Caller-provided icon lookup. Returns the LVGL image descriptor
/// for the bitmap matching `name`, or nullptr when the cache hasn't
/// resolved one yet (in which case we fall back to the text badge).
/// Pulling this out as a function lets TaskCard.h stay decoupled
/// from IconCache.h — the screen layer wires the two together.
using IconLookupFn =
    std::function<const lv_image_dsc_t*(const std::string& name)>;

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
                                   int ringWidth = 3,
                                   const IconLookupFn* iconLookup = nullptr) {
    const int tier = designUrgencyTier(item);
    const lv_color_t tone = urgencyTone(tier);
    const int fillDeg = urgencyFillDegrees(tier);

    // CVD redundancy: ring stroke width varies with urgency so a
    // colour-blind viewer still gets a per-tier signal. The
    // baseline `ringWidth` is the "tier 1" stroke; tier 0 idles a
    // pixel thinner, tier 3 a pixel thicker. Capped at ≥ 1 so a
    // 1-px baseline doesn't underflow.
    int adjRing = ringWidth;
    if (tier == 0)      adjRing = ringWidth - 1;
    else if (tier == 3) adjRing = ringWidth + 1;
    if (adjRing < 1) adjRing = 1;
    const int effRing = adjRing;

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
    lv_obj_set_style_arc_width(arc, effRing, LV_PART_MAIN);
    lv_obj_set_style_arc_width(arc, effRing, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(arc, Palette::lineSoft(), LV_PART_MAIN);
    lv_obj_set_style_arc_color(arc, tone, LV_PART_INDICATOR);
    lv_obj_set_style_arc_rounded(arc, true, LV_PART_INDICATOR);
    // Hide the arc's own background so the disc behind shines through
    // — only the stroke ring should be visible.
    lv_obj_set_style_bg_opa(arc, LV_OPA_0, 0);
    lv_obj_set_style_border_width(arc, 0, 0);
    lv_obj_set_style_pad_all(arc, 0, 0);

    // Inner disc — the avatar surface itself. Inset by effRing + 1
    // so the ring has a 1 px breathing gap to the disc edge.
    const int innerInset = effRing + 1;
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

    // Inner glyph. Lookup order:
    //   1. iconLookup callback (the screen's IconCache) — if it
    //      returns a real bitmap, render via lv_image with recolour
    //      to ink; this is the production path with backend-served
    //      icons matching the webapp.
    //   2. badgeTextForIcon — LVGL FontAwesome subset / 2-letter
    //      code fallback for icon names the cache hasn't resolved.
    //   3. taskInitials — last resort when the avatarId isn't an
    //      icon reference at all (e.g. uploaded photo by UUID).
    const char* iconKey = iconKeyFromAvatar(item.avatarId);
    const lv_image_dsc_t* iconDsc = nullptr;
    if (iconKey && iconLookup && *iconLookup) {
        iconDsc = (*iconLookup)(std::string(iconKey));
    }

    if (iconDsc) {
        // Render the cached A8 bitmap. recolor + recolor_opa make
        // LVGL paint alpha-set pixels in the ink colour; 0-alpha
        // stays transparent so the disc background shows through.
        auto* img = lv_image_create(disc);
        lv_image_set_src(img, iconDsc);
        lv_obj_set_style_image_recolor(img, Palette::ink(), 0);
        lv_obj_set_style_image_recolor_opa(img, LV_OPA_COVER, 0);
        // Bitmap is fixed at 24×24 (see backend seed). Scale to
        // fit the disc — LVGL's scale is in 256ths (256 = 1.0×).
        // Antialiasing off because pixel-art at sub-1.5× scale looks
        // crisper with nearest-neighbour than bilinear (the icons
        // are line drawings; their thin strokes blur away if we
        // average pixels).
        const int scale = (innerSize * 256) / 24;
        lv_image_set_scale(img, scale);
        lv_image_set_antialias(img, false);
        lv_obj_center(img);
    } else {
        const char* glyph = iconKey ? badgeTextForIcon(iconKey)
                                     : taskInitials(item.title);
        auto* lbl = lv_label_create(disc);
        lv_label_set_text(lbl, glyph);
        lv_obj_set_style_text_color(lbl, Palette::ink(), 0);
        // Pick a font that fits the disc — full ramp now that
        // 10/12 are enabled in lv_conf, so the mini's 12-px inner
        // disc no longer truncates a 14-pt glyph.
        const lv_font_t* font = (innerSize >= 32) ? &lv_font_montserrat_22
                              : (innerSize >= 22) ? &lv_font_montserrat_18
                              : (innerSize >= 14) ? &lv_font_montserrat_14
                              : (innerSize >= 11) ? &lv_font_montserrat_12
                                                  : &lv_font_montserrat_10;
        lv_obj_set_style_text_font(lbl, font, 0);
        lv_obj_center(lbl);
    }

    return wrap;
}

// ─── Detail card — compact 38 px banner (dev-24 redesign) ────────
//
// Built INTO the parent slot via LV_ALIGN_CENTER. The "selected"
// state is communicated by the title rendering through MarqueeLabel
// (the centre task's name scrolls when it overflows; mini neighbours
// truncate with "..."). The card itself is now only ~14 px taller
// than a mini row, removing the visual "this is a different kind of
// thing" jolt that the old 58 px version had.
//
// Layout, left → right:
//   • 28 px status-arc avatar (urgency-coloured ring + icon disc)
//   • marquee title — single-line, scrolls horizontally if longer
//     than the available viewport
//   • status row below the title — 6 px tone dot + mono caption
//
// The check button is gone in dev-24; activate is dispatched via
// the drum's centre-slot CLICKED handler / ScreenManager fireActivate
// rather than a discrete button. Removing it freed ~30 px of
// horizontal real estate the marquee now uses for the title.
//
// The card border is 1 px in the urgency tone for tier ≥ 1, soft
// line otherwise, so even from across the room you can see whether
// "this thing is urgent". Background = paper2.
inline lv_obj_t* buildDetailedTaskCard(
    lv_obj_t* parent,
    const domain::DashboardItem& item,
    int64_t serverNowSec,
    const IconLookupFn* iconLookup = nullptr) {
    const int tier = designUrgencyTier(item);
    const lv_color_t tone = urgencyTone(tier);

    lv_obj_update_layout(parent);
    const int parentW = lv_obj_get_width(parent);
    const int cardW   = (parentW > 4 ? parentW - 4 : 200);
    constexpr int kCardH    = 38;    // dev-24: shrunk 58→38
    constexpr int kAvatarSz = 28;    // dev-24: shrunk 42→28
    constexpr int kPadL     = 6;
    constexpr int kPadR     = 8;
    constexpr int kGap      = 8;

    auto* card = lv_obj_create(parent);
    lv_obj_set_size(card, cardW, kCardH);
    lv_obj_align(card, LV_ALIGN_CENTER, 0, 0);
    lv_obj_clear_flag(card, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_radius(card, 14, 0);
    lv_obj_set_style_bg_color(card, Palette::paper2(), 0);
    lv_obj_set_style_border_color(card,
        tier >= 1 ? tone : Palette::lineSoft(), 0);
    lv_obj_set_style_border_width(card, tier >= 2 ? 2 : 1, 0);
    lv_obj_set_style_pad_all(card, 0, 0);

    // Avatar — left edge.
    auto* avatar = buildStatusAvatar(card, item,
                                     /*size=*/kAvatarSz, /*ring=*/3,
                                     iconLookup);
    lv_obj_align(avatar, LV_ALIGN_LEFT_MID, kPadL, 0);

    // Title block: marquee for the title (single-line, scrolls when
    // longer than the viewport), then a status row below it. The
    // marquee's viewport is centred by default; we override its
    // alignment after build() to anchor at the left edge of the
    // title block.
    const int blockX = kPadL + kAvatarSz + kGap;
    const int blockW = cardW - blockX - kPadR;
    const int titleW = blockW > 40 ? blockW : 40;
    const lv_font_t* titleFont = &lv_font_montserrat_14;

    {
        MarqueeLabel marquee;
        marquee.setSegments({
            {item.title.empty() ? std::string{"(untitled)"} : item.title,
             Palette::ink()},
        });
        marquee.build(card, titleW, /*yOffset=*/0, /*xOffset=*/0,
                      titleFont);
        // Re-anchor the marquee's viewport at the left-of-title
        // position; the marquee defaults to LV_ALIGN_CENTER which
        // would place it in the middle of the card.
        if (marquee.viewport()) {
            lv_obj_align(marquee.viewport(),
                         LV_ALIGN_LEFT_MID, blockX, -7);
        }
    }

    // Status row — 6 px tone dot at blockX, mono caption right of it.
    auto* dot = lv_obj_create(card);
    lv_obj_set_size(dot, 5, 5);
    lv_obj_align(dot, LV_ALIGN_LEFT_MID, blockX, 9);
    lv_obj_clear_flag(dot, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_clear_flag(dot, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_radius(dot, 3, 0);
    lv_obj_set_style_bg_color(dot, tone, 0);
    lv_obj_set_style_border_width(dot, 0, 0);
    lv_obj_set_style_pad_all(dot, 0, 0);

    // Caption: dedupe MISSED. tier 3's urgencyCaption is "MISSED";
    // taskDueChip also returns "MISSED" when isMissed is true →
    // naive concat printed "MISSED  MISSED" in the dev-23 build.
    // Now we drop the duplicate when the two strings match.
    auto* caption = lv_label_create(card);
    char buf[40];
    const char* head = urgencyCaption(tier);
    const char* due  = taskDueChip(item.dueAt, serverNowSec,
                                    item.isMissed);
    const bool sameAsDue = (due[0] != 0) && (strcmp(head, due) == 0);
    if (due[0] != 0 && !sameAsDue) {
        snprintf(buf, sizeof(buf), "%s  %s", head, due);
    } else {
        snprintf(buf, sizeof(buf), "%s", head);
    }
    lv_label_set_text(caption, buf);
    lv_obj_set_style_text_color(caption, tone, 0);
    lv_obj_set_style_text_font(caption, &lv_font_montserrat_10, 0);
    lv_obj_align(caption, LV_ALIGN_LEFT_MID, blockX + 9, 9);

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
    int64_t serverNowSec,
    const IconLookupFn* iconLookup = nullptr) {
    const int tier = designUrgencyTier(item);
    const lv_color_t tone = urgencyTone(tier);

    // Force layout flush so parent width is real before we read it.
    // Same race the detail card hit on first build.
    lv_obj_update_layout(parent);
    const int parentW = lv_obj_get_width(parent);
    const int rowW    = (parentW > 4 ? parentW - 4 : 168);
    constexpr int kRowH    = 24;
    constexpr int kAvatar  = 18;       // shrunk from 20 → tighter pill
    constexpr int kPadL    = 4;
    constexpr int kPadR    = 6;
    constexpr int kGap     = 5;
    // Mini font is montserrat_12 — about 30 % smaller line height
    // than the detail card's montserrat_18 title. The chip uses
    // montserrat_10 so the urgency time stamp doesn't compete with
    // the title for visual weight at a glance.
    const lv_font_t* titleFont = &lv_font_montserrat_12;
    const lv_font_t* chipFont  = &lv_font_montserrat_10;

    auto* row = lv_obj_create(parent);
    lv_obj_set_size(row, rowW, kRowH);
    lv_obj_align(row, LV_ALIGN_CENTER, 0, yOffset);
    lv_obj_clear_flag(row, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_radius(row, 10, 0);
    // dev-26: less contrast — paper3 (one notch darker than the
    // centre card's paper2) for the bg and ink2 (mid-tone) for the
    // title. Both themes get a quieter mini that doesn't fight the
    // selected detail for visual weight. The urgency-tone due chip
    // and avatar arc still read clearly because their colour is
    // independent of the bg.
    lv_obj_set_style_bg_color(row, Palette::paper3(), 0);
    lv_obj_set_style_border_color(row, Palette::lineSoft(), 0);
    lv_obj_set_style_border_width(row, 1, 0);
    lv_obj_set_style_pad_all(row, 0, 0);

    // Status-arc avatar at the left; ring 2 px reads cleaner at this
    // smaller diameter than the detail card's 3 px would.
    auto* avatar = buildStatusAvatar(row, item, /*size=*/kAvatar, /*ring=*/2,
                                      iconLookup);
    lv_obj_align(avatar, LV_ALIGN_LEFT_MID, kPadL, 0);

    // Due chip — right edge. Width approximated from char count so
    // we can reserve space for the title without depending on a
    // post-layout width read. Montserrat_10 is ~5 px / char.
    const char* due = taskDueChip(item.dueAt, serverNowSec, item.isMissed);
    int dueW = 0;
    if (due[0] != 0) {
        auto* chip = lv_label_create(row);
        lv_label_set_text(chip, due);
        lv_obj_set_style_text_color(chip, tone, 0);
        lv_obj_set_style_text_font(chip, chipFont, 0);
        lv_obj_align(chip, LV_ALIGN_RIGHT_MID, -kPadR, 0);
        dueW = static_cast<int>(strlen(due)) * 5 + 4;
    }

    // Title — explicit width AND height so LVGL truncates with "..."
    // on overflow rather than wrapping to a second line that overflows
    // the row. Without the height clamp LV_LABEL_LONG_DOT lets the
    // label grow vertically until the text fits, which is what made
    // mini titles wrap on the on-device screenshot.
    auto* title = lv_label_create(row);
    lv_label_set_text(title, item.title.empty()
                              ? "(untitled)" : item.title.c_str());
    lv_label_set_long_mode(title, LV_LABEL_LONG_DOT);
    const int titleW = rowW - kPadL - kAvatar - kGap - dueW - kPadR;
    const int titleH = lv_font_get_line_height(titleFont);
    lv_obj_set_size(title, titleW > 30 ? titleW : 30, titleH);
    lv_obj_set_style_text_color(title, Palette::ink2(), 0);
    lv_obj_set_style_text_font(title, titleFont, 0);
    lv_obj_align(title, LV_ALIGN_LEFT_MID, kPadL + kAvatar + kGap, 0);

    return row;
}

// ─── Shadow card — tier ±2 silhouette ────────────────────────────
//
// Per the dev-23 user spec: the dashboard / all-tasks drum should
// only render real data for 3 cards (centre + ±1). The next ring of
// neighbours (±2) shows just a "shadow" — same rounded shape as the
// mini, no avatar / title / chip. This both reinforces the depth
// effect (the pile recedes into shapes you can't read) and makes
// the design's spec ("for the +2 and -2 tasks display only the
// shadow of the card without real data") explicit in code.
//
// The shadow is rendered translucent — solid bg + soft border at
// reduced opacity. The drum's per-distance opacity setting is what
// dims it in proportion; we keep colour values at full strength here
// so the dim factor is the only knob the screen passes in.
inline lv_obj_t* buildShadowTaskCard(lv_obj_t* parent) {
    lv_obj_update_layout(parent);
    const int parentW = lv_obj_get_width(parent);
    const int rowW    = (parentW > 4 ? parentW - 4 : 148);
    constexpr int kRowH = 24;

    auto* shadow = lv_obj_create(parent);
    lv_obj_set_size(shadow, rowW, kRowH);
    lv_obj_align(shadow, LV_ALIGN_CENTER, 0, 0);
    lv_obj_clear_flag(shadow, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_clear_flag(shadow, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_radius(shadow, 10, 0);
    lv_obj_set_style_bg_color(shadow, Palette::paper3(), 0);
    lv_obj_set_style_bg_opa(shadow, LV_OPA_70, 0);
    lv_obj_set_style_border_color(shadow, Palette::lineSoft(), 0);
    lv_obj_set_style_border_width(shadow, 1, 0);
    lv_obj_set_style_pad_all(shadow, 0, 0);
    return shadow;
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
                                 int64_t serverNowSec,
                                 const IconLookupFn* iconLookup = nullptr) {
    const int dist = tier < 0 ? -tier : tier;
    if (dist == 0) {
        buildDetailedTaskCard(slot, item, serverNowSec, iconLookup);
    } else if (dist == 1) {
        buildMiniTaskCard(slot, item, /*yOffset=*/0, serverNowSec,
                          iconLookup);
    } else {
        // dist >= 2 — shadow only, no real data.
        // The drum's per-distance opacity dims this further so the
        // ±2 ring fades into the rim. ±3+ never reaches this code
        // path because DrumScroller's setMaxVisibleDistance(2) on
        // the task drum hides those slots entirely.
        buildShadowTaskCard(slot);
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

// ─── Dashboard bottom bar (dev-27) ───────────────────────────────
//
// Single horizontal row spanning most of the disc width near the
// bottom. Three independent groups, manually positioned so we don't
// depend on flex layout edge-cases:
//
//   ••• +              7              ••  +
//   ←─ red (left)     centre count    yellow (right) ─→
//   missed/urgent     total            upcoming/soon
//
// • Red dots (urgency tier 3) anchor LEFT, packed left-to-right.
// • Yellow dots (tier 1) anchor RIGHT, packed right-to-left so the
//   final "+" sits at the rightmost position.
// • Total dashboard count sits centred between the two groups.
//
// Each tier caps at 3 dots; any overflow appends a tone-matched
// "+". An empty tier shows nothing on its side. Manual lv_obj_set_pos
// avoids the flex-row clipping the dev-26 implementation hit when
// the row's height was smaller than the "+" label's natural height.
//
// Returns the wrapping container; caller positions it.
inline lv_obj_t* buildDashboardBottomBar(
    lv_obj_t* parent,
    const TierCounts& counts,
    size_t totalDashboardCount) {
    constexpr int kMaxDotsPerTier = 3;
    constexpr int kDotSize = 6;
    constexpr int kDotGap  = 4;
    constexpr int kPlusW   = 8;
    // Wide enough for two 3+plus groups and a centred count comfortably
    // inside the disc's bottom chord (≈ 188 px at y=210).
    constexpr int kRowW    = 180;
    constexpr int kRowH    = 16;
    const int dotY = (kRowH - kDotSize) / 2;

    auto* row = lv_obj_create(parent);
    lv_obj_set_size(row, kRowW, kRowH);
    lv_obj_clear_flag(row, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_clear_flag(row, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_bg_opa(row, LV_OPA_0, 0);
    lv_obj_set_style_border_width(row, 0, 0);
    lv_obj_set_style_pad_all(row, 0, 0);

    // ── LEFT: missed / urgent in tier-3 terracotta ───────────────
    {
        const lv_color_t tone = urgencyTone(3);
        const size_t total = counts.urgent;
        const size_t dots  = total > kMaxDotsPerTier
                           ? kMaxDotsPerTier : total;
        int x = 0;
        for (size_t i = 0; i < dots; ++i) {
            auto* dot = lv_obj_create(row);
            lv_obj_set_size(dot, kDotSize, kDotSize);
            lv_obj_set_pos(dot, x, dotY);
            lv_obj_clear_flag(dot, LV_OBJ_FLAG_SCROLLABLE);
            lv_obj_clear_flag(dot, LV_OBJ_FLAG_CLICKABLE);
            lv_obj_set_style_radius(dot, kDotSize / 2, 0);
            lv_obj_set_style_bg_color(dot, tone, 0);
            lv_obj_set_style_border_width(dot, 0, 0);
            lv_obj_set_style_pad_all(dot, 0, 0);
            x += kDotSize + kDotGap;
        }
        if (total > kMaxDotsPerTier) {
            auto* plus = lv_label_create(row);
            lv_label_set_text(plus, "+");
            lv_obj_set_style_text_color(plus, tone, 0);
            lv_obj_set_style_text_font(plus, &lv_font_montserrat_10, 0);
            // y = -1 nudges the "+" baseline up so it visually centres
            // on the dots rather than sitting below them.
            lv_obj_set_pos(plus, x - 2, -1);
        }
    }

    // ── RIGHT: upcoming / soon in tier-1 amber ───────────────────
    {
        const lv_color_t tone = urgencyTone(1);
        const size_t total = counts.soon;
        const size_t dots  = total > kMaxDotsPerTier
                           ? kMaxDotsPerTier : total;
        int x = kRowW;
        if (total > kMaxDotsPerTier) {
            x -= kPlusW;
            auto* plus = lv_label_create(row);
            lv_label_set_text(plus, "+");
            lv_obj_set_style_text_color(plus, tone, 0);
            lv_obj_set_style_text_font(plus, &lv_font_montserrat_10, 0);
            lv_obj_set_pos(plus, x, -1);
        }
        for (size_t i = 0; i < dots; ++i) {
            x -= kDotSize + kDotGap;
            auto* dot = lv_obj_create(row);
            lv_obj_set_size(dot, kDotSize, kDotSize);
            // Pull right-most dot flush to the right edge — the gap
            // belongs between dots, not at the rightmost outside.
            lv_obj_set_pos(dot, x + (i == 0 && total <= kMaxDotsPerTier
                                     ? kDotGap : 0), dotY);
            lv_obj_clear_flag(dot, LV_OBJ_FLAG_SCROLLABLE);
            lv_obj_clear_flag(dot, LV_OBJ_FLAG_CLICKABLE);
            lv_obj_set_style_radius(dot, kDotSize / 2, 0);
            lv_obj_set_style_bg_color(dot, tone, 0);
            lv_obj_set_style_border_width(dot, 0, 0);
            lv_obj_set_style_pad_all(dot, 0, 0);
        }
    }

    // ── CENTRE: total dashboard task count ───────────────────────
    if (totalDashboardCount > 0) {
        auto* total = lv_label_create(row);
        char buf[8];
        snprintf(buf, sizeof(buf), "%u",
                 static_cast<unsigned>(totalDashboardCount));
        lv_label_set_text(total, buf);
        lv_obj_set_style_text_color(total, Palette::ink2(), 0);
        lv_obj_set_style_text_font(total, &lv_font_montserrat_10, 0);
        lv_obj_align(total, LV_ALIGN_CENTER, 0, 0);
    }

    return row;
}

// Legacy alias retained so callers compiled against dev-26 still
// link until they migrate. The new bar adds a centred total count
// and explicit left/right alignment per dev-27 user spec.
inline lv_obj_t* buildBottomDotIndicator(
    lv_obj_t* parent, const TierCounts& counts) {
    return buildDashboardBottomBar(parent, counts, /*total=*/0);
}

}  // namespace howler::screens::components
