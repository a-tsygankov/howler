#pragma once

#include "DrumScroller.h"
#include "IconCache.h"
#include "RoundCard.h"
#include "TaskCard.h"  // iconKeyFromAvatar + badgeTextForIcon helpers
#include "../../domain/RoundMenuModel.h"

#include <Arduino.h>
#include <functional>
#include <lvgl.h>

namespace howler::screens::components {

/// A round-display-friendly menu — visually a watch-style carousel
/// implemented as a thin wrapper around DrumScroller. The selected
/// item sits in the centre rendered big with its subtitle; the
/// previous / next items show as smaller text above and below; far-
/// away items render even smaller and faded ("drum-rim" tier).
/// Rotation events from the encoder cycle the cursor; vertical swipes
/// from the touch IC do the same with inertial magnitude (fast flick
/// jumps multiple items, ease-out lands on the new selection); the
/// calling screen routes taps via `setOnActivate()`.
///
/// Why not lv_list: lv_list is a vertical rectangle. On a 240×240
/// circular display the corners are clipped and a flat list looks
/// jarring against the circular bezel. The drum keeps the
/// interactive surface inside the circle and makes the selected
/// item unambiguous (size + brightness, not a focus ring).
///
/// The component is stateless w.r.t. the items — owners pass items
/// via a `domain::RoundMenuModel` reference (so the model is
/// authoritative for cursor, sort, and additions/removals). The
/// drum stays in sync via `setCursor` / `scrollBy`; cursor moves
/// here mutate the model so the rest of the app doesn't have to
/// reach through the widget to read state.
class RoundMenu {
public:
    using ActivateFn = std::function<void(const domain::RoundMenuItem&)>;

    /// Build the carousel widgets into `parent`. Pass an existing
    /// model — RoundMenu reads from it on every refresh(). The
    /// optional `iconLookup` enables avatar-badge rendering on the
    /// centre slot for items whose `iconKey` carries a recognisable
    /// avatar id (UserPicker uses this; Settings menu doesn't pass
    /// it because none of its items have avatars). Default null →
    /// title-only centre card, matching the pre-avatar layout.
    void build(lv_obj_t* parent, domain::RoundMenuModel& model,
               const IconLookupFn* iconLookup = nullptr) {
        model_  = &model;
        parent_ = parent;
        iconLookup_ = iconLookup;
        // Drum tunings: the round display gives us ~200 px of vertical
        // headroom between the tab strip (y≈30) and the footer hint
        // (y≈220). Five tiers at 50 px spacing fits comfortably with
        // tier ±2 sneaking past the corners (clipped by the circle,
        // which is fine — they're hint-tier anyway).
        drum_.build(parent, /*viewWidth=*/200, /*viewHeight=*/220,
                    /*tierSpacing=*/50);

        drum_.setRender([this](lv_obj_t* slot, size_t idx, int tier) {
            renderSlot(slot, idx, tier);
        });
        drum_.setOnActivate([this](size_t idx) {
            if (!model_ || !onActivate_) return;
            // Sync the model cursor from the drum so the tap activates
            // exactly the item that's centred. Belt-and-braces — the
            // two should already match because every cursor mutation
            // funnels through scrollBy() which updates both.
            model_->setCursor(idx);
            const auto* sel = model_->selected();
            if (sel) onActivate_(*sel);
        });

        refresh();
    }

    /// Re-render labels after a model mutation (cursor change,
    /// items replaced). Cheap; reuses drum slot widgets. Caller
    /// invokes after `model.replace(...)` from outside.
    void refresh() {
        if (!model_) return;
        drum_.setItemCount(model_->size());
        // Use setCursor (not scrollBy) — refresh() shouldn't animate;
        // it's a "pick up new model state" call, not a user gesture.
        drum_.setCursor(model_->cursor());
    }

    /// Owner registers a callback that runs when the centre item is
    /// activated (tap / knob press). The screen layer translates this
    /// into router pushes / commits as needed.
    void setOnActivate(ActivateFn fn) { onActivate_ = std::move(fn); }

    /// Translate a rotation delta (knob CW/CCW) into a cursor move.
    /// Magnitude 1 — encoder detents are inherently single-step. The
    /// drum still plays its short slide animation so the visual
    /// continuity matches a touch-driven scroll. Returns true if the
    /// cursor changed.
    bool onRotate(int delta) {
        return onScroll(delta, 1);
    }

    /// Inertial scroll path — magnitude > 1 jumps the cursor multiple
    /// items in one gesture, with the drum's ease-out animation
    /// scaling to the longer travel. Used by ScreenManager when a
    /// touch swipe arrives carrying a velocity-derived magnitude.
    bool onScroll(int direction, int magnitude) {
        if (!model_ || direction == 0) return false;
        const int steps = direction * (magnitude < 1 ? 1 : magnitude);
        model_->moveCursor(steps);
        // Drum's scrollBy handles the visual side and updates its own
        // cursor; pass the same direction+magnitude so its modulo
        // arithmetic lands on the same index as the model's.
        drum_.scrollBy(direction, magnitude < 1 ? 1 : magnitude);
        // Belt-and-braces: re-snap drum cursor in case the model
        // applies any clamping the drum's wrap doesn't (today both
        // wrap modulo size, so this is identity — but cheap).
        drum_.setCursor(model_->cursor());
        return true;
    }

    /// Activate the centre item from outside (e.g., the screen's tap
    /// handler in ScreenManager::onEvent — useful when LVGL's own
    /// click event isn't routed through, or to keep activation logic
    /// in one place).
    void fireActivate() {
        if (!model_ || !onActivate_) return;
        const auto* sel = model_->selected();
        if (sel) onActivate_(*sel);
    }

private:
    /// Renders one slot at the given tier. Centre slot gets a
    /// rounded card with title + subtitle; neighbour tiers are
    /// title-only labels so the stack reads cleanly without competing
    /// chrome around the centre.
    void renderSlot(lv_obj_t* slot, size_t idx, int tier) {
        if (!model_) return;
        const auto& items = model_->items();
        if (idx >= items.size()) return;
        const auto& it = items[idx];

        if (tier == 0) {
            // Centre: rounded card with title + subtitle. Destructive
            // items get the accent border so the user notices before
            // they long-press. When an avatar lookup is wired AND the
            // item carries an iconKey the lookup resolves, we render
            // a 30-px circular avatar to the left of the title and
            // shrink the text width to keep things from colliding.
            auto* card = lv_obj_create(slot);
            lv_obj_set_size(card, 200, 70);
            lv_obj_align(card, LV_ALIGN_CENTER, 0, 0);
            lv_obj_clear_flag(card, LV_OBJ_FLAG_SCROLLABLE);
            lv_obj_set_style_bg_color(card, Palette::paper2(), 0);
            lv_obj_set_style_radius(card, 18, 0);
            lv_obj_set_style_border_color(card,
                it.destructive ? Palette::accent() : Palette::lineSoft(), 0);
            lv_obj_set_style_border_width(card,
                it.destructive ? 2 : 1, 0);
            lv_obj_set_style_pad_all(card, 6, 0);

            // Avatar badge — small circular disc on the left side of
            // the card, mirroring the webapp's user / task list. The
            // badge renders one of three things, in priority order:
            //   1. cached bitmap from the IconCache (for `icon:foo`
            //      avatar ids whose name has been fetched);
            //   2. badgeTextForIcon's LVGL-symbol or two-letter code
            //      (icon name not yet cached);
            //   3. skipped entirely when iconKey is empty (e.g. the
            //      "skip" item in UserPicker — no avatar).
            constexpr int kBadgeSize = 30;
            const bool wantsBadge = !it.iconKey.empty() && iconLookup_;
            int textLeftInset = 0;
            if (wantsBadge) {
                auto* disc = lv_obj_create(card);
                lv_obj_set_size(disc, kBadgeSize, kBadgeSize);
                lv_obj_align(disc, LV_ALIGN_LEFT_MID, 4, 0);
                lv_obj_clear_flag(disc, LV_OBJ_FLAG_SCROLLABLE);
                lv_obj_clear_flag(disc, LV_OBJ_FLAG_CLICKABLE);
                lv_obj_set_style_radius(disc, LV_RADIUS_CIRCLE, 0);
                lv_obj_set_style_bg_color(disc, Palette::paper3(), 0);
                lv_obj_set_style_border_width(disc, 0, 0);
                lv_obj_set_style_pad_all(disc, 0, 0);

                const char* iconKey = iconKeyFromAvatar(it.iconKey);
                const lv_image_dsc_t* iconDsc = nullptr;
                if (iconKey && iconLookup_ && *iconLookup_) {
                    iconDsc = (*iconLookup_)(std::string(iconKey));
                }
                if (iconDsc) {
                    auto* img = lv_image_create(disc);
                    lv_image_set_src(img, iconDsc);
                    lv_obj_set_style_image_recolor(img, Palette::ink(), 0);
                    lv_obj_set_style_image_recolor_opa(img, LV_OPA_COVER, 0);
                    // Bitmap is 24×24; scale to fit the disc.
                    const int scale = (kBadgeSize * 256) / 24;
                    lv_image_set_scale(img, scale);
                    lv_image_set_antialias(img, false);
                    lv_obj_center(img);
                } else {
                    // Fallback: badgeText for `icon:foo` names that
                    // haven't cached yet, or the title's first two
                    // letters when the avatar is a UUID photo (TaskCard
                    // uses the same fallback chain — keeps the device
                    // visually consistent).
                    const char* glyph = iconKey
                        ? badgeTextForIcon(iconKey)
                        : (it.title.empty() ? "?" : nullptr);
                    char fallback[3] = {0, 0, 0};
                    if (!glyph) {
                        const auto& t = it.title;
                        fallback[0] = static_cast<char>(t[0]);
                        if (t.size() >= 2) {
                            fallback[1] = static_cast<char>(t[1]);
                        }
                        glyph = fallback;
                    }
                    auto* lbl = lv_label_create(disc);
                    lv_label_set_text(lbl, glyph);
                    lv_obj_set_style_text_color(lbl, Palette::ink(), 0);
                    lv_obj_set_style_text_font(lbl,
                        &lv_font_montserrat_14, 0);
                    lv_obj_center(lbl);
                }
                // Push the title off the badge — kBadgeSize + 4 px
                // hairline gap. Without this the title's centred
                // alignment would overlap the badge.
                textLeftInset = kBadgeSize + 8;
            }

            auto* title = lv_label_create(card);
            lv_label_set_long_mode(title, LV_LABEL_LONG_DOT);
            const int titleWidth = 184 - textLeftInset;
            lv_obj_set_width(title, titleWidth > 60 ? titleWidth : 60);
            lv_obj_set_style_text_align(title, LV_TEXT_ALIGN_LEFT, 0);
            lv_obj_set_style_text_color(title,
                DrumScroller::colorForTier(tier), 0);
            lv_obj_set_style_text_font(title,
                DrumScroller::fontForTier(tier), 0);
            lv_obj_set_style_text_opa(title,
                DrumScroller::opacityForTier(tier), 0);
            // Without an avatar badge we keep the original centred
            // layout (matches Settings menu rendering exactly). With
            // a badge, anchor left of card and shift past the badge.
            if (textLeftInset > 0) {
                lv_obj_align(title, LV_ALIGN_LEFT_MID,
                             textLeftInset,
                             it.subtitle.empty() ? 0 : -8);
            } else {
                lv_obj_set_style_text_align(title, LV_TEXT_ALIGN_CENTER, 0);
                lv_obj_align(title, LV_ALIGN_CENTER, 0,
                             it.subtitle.empty() ? 0 : -10);
            }
            lv_label_set_text(title, it.title.c_str());

            if (!it.subtitle.empty()) {
                auto* sub = lv_label_create(card);
                lv_label_set_long_mode(sub, LV_LABEL_LONG_DOT);
                const int subWidth = 184 - textLeftInset;
                lv_obj_set_width(sub, subWidth > 60 ? subWidth : 60);
                lv_obj_set_style_text_color(sub, Palette::ink2(), 0);
                if (textLeftInset > 0) {
                    lv_obj_set_style_text_align(sub, LV_TEXT_ALIGN_LEFT, 0);
                    lv_obj_align(sub, LV_ALIGN_LEFT_MID, textLeftInset, 12);
                } else {
                    lv_obj_set_style_text_align(sub, LV_TEXT_ALIGN_CENTER, 0);
                    lv_obj_align(sub, LV_ALIGN_CENTER, 0, 14);
                }
                lv_label_set_text(sub, it.subtitle.c_str());
            }
        } else {
            // Neighbour / rim: title-only label. Width is generous so
            // titles don't truncate aggressively at ±1; ±2 stays muted
            // (caller can lean on opacityForTier to fade further).
            auto* l = lv_label_create(slot);
            lv_label_set_long_mode(l, LV_LABEL_LONG_DOT);
            lv_obj_set_width(l, 180);
            lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, 0);
            lv_obj_set_style_text_color(l,
                DrumScroller::colorForTier(tier), 0);
            lv_obj_set_style_text_font(l,
                DrumScroller::fontForTier(tier), 0);
            lv_obj_set_style_text_opa(l,
                DrumScroller::opacityForTier(tier), 0);
            lv_obj_align(l, LV_ALIGN_CENTER, 0, 0);
            lv_label_set_text(l, it.title.c_str());
        }
    }

    domain::RoundMenuModel* model_      = nullptr;
    lv_obj_t*               parent_     = nullptr;
    DrumScroller            drum_;
    ActivateFn              onActivate_;
    /// Optional bound IconLookup callback — supplied by build() when
    /// the calling screen wants avatar badges on the centre slot.
    /// nullptr keeps the rendering path on the legacy title-only
    /// layout that Settings menu / Wi-Fi list rely on.
    const IconLookupFn*     iconLookup_ = nullptr;
};

}  // namespace howler::screens::components
