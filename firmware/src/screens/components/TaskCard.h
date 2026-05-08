#pragma once

// Shared "task card" widgets used by Dashboard + TaskList. Two flavours:
//
//  Detailed — large central card with icon, title, status line. The
//             selected task on every list-style screen renders this.
//             Diameter ~ 156 px so the perimeter arc widget has room.
//
//  Mini     — compact pill (~150×30) showing title only, with a tiny
//             leading dot in the urgency-tier accent. Used to hint at
//             the previous / next item above / below the detailed
//             card so the user sees what's adjacent in the list.
//
// Both are pure builders — no state, no event callbacks. The owning
// screen routes taps via ScreenManager's centralised dispatch.

#include "RoundCard.h"
#include "MarqueeLabel.h"
#include "../../domain/DashboardItem.h"

#include <Arduino.h>
#include <lvgl.h>
#include <ctype.h>
#include <stdio.h>
#include <vector>

namespace howler::screens::components {

inline lv_color_t accentForUrgency(domain::Urgency u, bool missed) {
    if (missed) return Palette::accent();
    switch (u) {
        case domain::Urgency::Urgent:    return Palette::accent();
        case domain::Urgency::NonUrgent: return Palette::warn();
        case domain::Urgency::Hidden:    return Palette::ink3();
    }
    return Palette::ink3();
}

inline const char* urgencyLabel(domain::Urgency u, bool missed) {
    if (missed) return "missed";
    switch (u) {
        case domain::Urgency::Urgent:    return "urgent";
        case domain::Urgency::NonUrgent: return "soon";
        case domain::Urgency::Hidden:    return "scheduled";
    }
    return "";
}

/// "in 14m" / "overdue 2h" / "no time set" relative to the server's
/// authoritative now. Returns a static buffer; safe to pass straight
/// into lv_label_set_text.
inline const char* taskDueLabel(int64_t dueAt, int64_t serverNowSec, bool missed) {
    static char buf[40];
    if (missed) return "MISSED";
    if (dueAt < 0) return "no time set";
    if (serverNowSec <= 0) {
        snprintf(buf, sizeof(buf), "scheduled");
        return buf;
    }
    const int64_t delta = dueAt - serverNowSec;
    const int64_t abs   = delta < 0 ? -delta : delta;
    const int64_t hours = abs / 3600;
    const int64_t mins  = (abs / 60) % 60;
    if (delta < 0) {
        if (hours > 0) snprintf(buf, sizeof(buf), "overdue %lldh", (long long)hours);
        else           snprintf(buf, sizeof(buf), "overdue %lldm", (long long)mins);
    } else {
        if (hours > 0) snprintf(buf, sizeof(buf), "in %lldh %lldm",
                                (long long)hours, (long long)mins);
        else           snprintf(buf, sizeof(buf), "in %lldm", (long long)mins);
    }
    return buf;
}

/// Pull the LVGL icon name out of a DashboardItem.avatarId. Avatar IDs
/// of the form "icon:name" carry the icon-set choice (mirroring the
/// webapp's `LABEL_ICON_CHOICES`); for explicit uploaded avatars
/// (regular UUIDs) we fall back to a generic glyph. Returns nullptr
/// when no usable icon name can be derived — caller renders without
/// an icon.
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
    if (n == "calendar") return LV_SYMBOL_DIRECTORY;  // closest in subset
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
    // Unknown name (perhaps a freshly-added webapp icon we haven't
    // mapped yet). Fall back to the first 1-2 letters of whatever
    // came in, capitalized.
    static char fb[3];
    fb[0] = static_cast<char>(toupper(static_cast<unsigned char>(n[0])));
    fb[1] = n.size() > 1
        ? static_cast<char>(toupper(static_cast<unsigned char>(n[1]))) : 0;
    fb[2] = 0;
    return fb;
}

/// Detailed task card — the centre of Dashboard / TaskList. ~156 px
/// diameter, accent-bordered for urgent / missed, contains:
///   • leading icon (label-derived if avatarId starts with "icon:")
///   • title (font-montserrat-18, 2-line wrap)
///   • status pill (urgency tier + relative due time)
inline lv_obj_t* buildDetailedTaskCard(
    lv_obj_t* parent,
    const domain::DashboardItem& item,
    int64_t serverNowSec) {
    const lv_color_t accent = accentForUrgency(item.urgency, item.isMissed);

    auto* card = buildCenterCard(parent, 156, Palette::paper2());
    const bool urgent = (item.urgency == domain::Urgency::Urgent) || item.isMissed;
    lv_obj_set_style_border_color(card, accent, 0);
    lv_obj_set_style_border_width(card, urgent ? 3 : 1, 0);

    // Icon badge — visible cue that maps to whatever the user picked
    // in the webapp's icon picker (paw / broom / home / …). Rendered
    // either as the matching LVGL FontAwesome symbol when one exists
    // or as a 2-letter code otherwise; see `badgeTextForIcon` for
    // the lookup table. The badge sits above the title so a long
    // marquee-scrolled title doesn't slide under it.
    const char* iconKey = iconKeyFromAvatar(item.avatarId);

    if (iconKey) {
        auto* badge = lv_obj_create(card);
        lv_obj_set_size(badge, 30, 30);
        lv_obj_align(badge, LV_ALIGN_TOP_MID, 0, 0);
        lv_obj_clear_flag(badge, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_style_radius(badge, 15, 0);
        lv_obj_set_style_bg_color(badge, accent, 0);
        lv_obj_set_style_border_width(badge, 0, 0);
        lv_obj_set_style_pad_all(badge, 0, 0);
        auto* gl = lv_label_create(badge);
        lv_label_set_text(gl, badgeTextForIcon(iconKey));
        lv_obj_set_style_text_color(gl, Palette::paper(), 0);
        lv_obj_set_style_text_font(gl, &lv_font_montserrat_18, 0);
        lv_obj_center(gl);
    }

    // Title rendered through MarqueeLabel: short titles stay static,
    // long ones auto-scroll. The MarqueeLabel value is stack-only —
    // LVGL owns the widgets it builds via the parent-child tree, so
    // letting the wrapper go out of scope at return is fine.
    {
        MarqueeLabel marquee;
        marquee.setSegments({
            {item.title.empty() ? std::string{"(untitled)"} : item.title,
             Palette::ink()},
        });
        marquee.build(card, /*viewWidth=*/130, iconKey ? 0 : -6,
                      /*xOffset=*/0, &lv_font_montserrat_18);
    }

    auto* sub = lv_label_create(card);
    char st[48];
    snprintf(st, sizeof(st), "%s | %s",
             urgencyLabel(item.urgency, item.isMissed),
             taskDueLabel(item.dueAt, serverNowSec, item.isMissed));
    lv_label_set_text(sub, st);
    lv_obj_set_style_text_color(sub, item.isMissed ? Palette::accent()
                                                   : Palette::ink2(), 0);
    lv_obj_align(sub, LV_ALIGN_BOTTOM_MID, 0, -8);

    return card;
}

/// Mini task card — pill-shaped, a tiny accent dot + truncated title.
/// `yOffset` is from screen centre (negative = above, positive = below).
/// Caller passes the parent root_ — the pill aligns relative to it.
inline lv_obj_t* buildMiniTaskCard(
    lv_obj_t* parent,
    const domain::DashboardItem& item,
    int yOffset) {
    const lv_color_t accent = accentForUrgency(item.urgency, item.isMissed);

    auto* row = lv_obj_create(parent);
    lv_obj_set_size(row, 168, 28);
    lv_obj_align(row, LV_ALIGN_CENTER, 0, yOffset);
    lv_obj_clear_flag(row, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_radius(row, 14, 0);
    lv_obj_set_style_bg_color(row, Palette::paper3(), 0);
    lv_obj_set_style_bg_opa(row, LV_OPA_70, 0);
    lv_obj_set_style_border_width(row, 0, 0);
    lv_obj_set_style_pad_all(row, 0, 0);

    // Leading accent dot (urgency tier).
    auto* dot = lv_obj_create(row);
    lv_obj_set_size(dot, 8, 8);
    lv_obj_align(dot, LV_ALIGN_LEFT_MID, 12, 0);
    lv_obj_clear_flag(dot, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_radius(dot, 4, 0);
    lv_obj_set_style_bg_color(dot, accent, 0);
    lv_obj_set_style_border_width(dot, 0, 0);
    lv_obj_set_style_pad_all(dot, 0, 0);

    auto* title = lv_label_create(row);
    lv_label_set_text(title, item.title.empty() ? "(untitled)" : item.title.c_str());
    lv_label_set_long_mode(title, LV_LABEL_LONG_DOT);
    lv_obj_set_width(title, 130);
    lv_obj_set_style_text_color(title, Palette::ink2(), 0);
    lv_obj_align(title, LV_ALIGN_LEFT_MID, 28, 0);

    return row;
}

/// Tier counts header — three small pills at the top showing how
/// many urgent / soon / scheduled tasks live in the source list.
/// Empty pills (count == 0) collapse out so the header stays clean
/// when the home is healthy. Returns the row container.
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
