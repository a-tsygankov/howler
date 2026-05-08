#pragma once

// Multi-segment label that scrolls horizontally when its full content
// doesn't fit in the parent's width. Each segment carries its own
// colour, so headlines like "feed Tiri |  03:00pm  |  overdue 2h"
// can render with mixed accents in a single visual unit.
//
// The component is built once on screen entry. Internally it holds a
// row of `lv_label` children laid out left-to-right; if the natural
// width exceeds the configured `viewWidth`, an LVGL animation slides
// the whole row leftward by 1 px every ~40 ms (cycling back to start
// after the end + a small tail of whitespace passes the viewport's
// left edge — gives a clear visual break between cycles).
//
// Use:
//   MarqueeLabel m;
//   m.setSegments({{"feed Tiri", Palette::ink()},
//                  {" | ",        Palette::ink3()},
//                  {"overdue",    Palette::accent()}});
//   m.build(parent, /*viewWidth=*/180, /*y=*/-12);

#include "RoundCard.h"

#include <Arduino.h>
#include <lvgl.h>
#include <stdint.h>
#include <string>
#include <vector>

namespace howler::screens::components {

struct MarqueeSegment {
    std::string text;
    lv_color_t  color;
};

class MarqueeLabel {
public:
    void setSegments(std::vector<MarqueeSegment> segs) {
        segments_ = std::move(segs);
    }

    /// Build under `parent`. The viewport is `viewWidth × viewHeight`
    /// (height matches the chosen font's line height plus a few pixels
    /// of padding). Position relative to parent centre via `xOffset`/
    /// `yOffset`. The font is whatever the parent inherits unless
    /// overridden via `setFont`.
    void build(lv_obj_t* parent, int viewWidth, int yOffset = 0,
               int xOffset = 0,
               const lv_font_t* font = &lv_font_montserrat_18) {
        font_ = font;
        viewport_ = lv_obj_create(parent);
        lv_obj_set_size(viewport_, viewWidth, lv_font_get_line_height(font_) + 4);
        lv_obj_align(viewport_, LV_ALIGN_CENTER, xOffset, yOffset);
        lv_obj_clear_flag(viewport_, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_style_bg_opa(viewport_, LV_OPA_0, 0);
        lv_obj_set_style_border_width(viewport_, 0, 0);
        lv_obj_set_style_pad_all(viewport_, 0, 0);
        lv_obj_set_style_clip_corner(viewport_, true, 0);
        // The "track" sits inside the viewport; we slide it left by
        // animating its x position. Its own width is the natural sum
        // of its child labels (set after we add them).
        track_ = lv_obj_create(viewport_);
        lv_obj_clear_flag(track_, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_style_bg_opa(track_, LV_OPA_0, 0);
        lv_obj_set_style_border_width(track_, 0, 0);
        lv_obj_set_style_pad_all(track_, 0, 0);
        lv_obj_set_layout(track_, LV_LAYOUT_FLEX);
        lv_obj_set_flex_flow(track_, LV_FLEX_FLOW_ROW);
        lv_obj_set_flex_align(track_, LV_FLEX_ALIGN_START,
                              LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
        // Render each segment as its own label so colour mixes work.
        contentWidth_ = 0;
        for (const auto& s : segments_) {
            auto* l = lv_label_create(track_);
            lv_label_set_text(l, s.text.c_str());
            lv_obj_set_style_text_color(l, s.color, 0);
            lv_obj_set_style_text_font(l, font_, 0);
            // Force full-width so flex doesn't wrap inside a label.
            lv_label_set_long_mode(l, LV_LABEL_LONG_CLIP);
            lv_obj_update_layout(l);
            contentWidth_ += lv_obj_get_width(l);
        }

        // Tail space — separates "end" from "begin" on the next loop.
        constexpr int kTail = 24;
        lv_obj_set_size(track_, contentWidth_ + kTail,
                        lv_font_get_line_height(font_));
        lv_obj_align(track_, LV_ALIGN_LEFT_MID, 0, 0);

        // Decide whether to animate. If the content fits, leave it
        // statically aligned and skip the animation (saves CPU + stops
        // a single short word from sliding pointlessly).
        if (contentWidth_ <= viewWidth) return;

        // Animation: slide track from x=0 to x = -(contentWidth + tail)
        // then snap back. ~40 ms per pixel = readable scroll speed.
        lv_anim_t a;
        lv_anim_init(&a);
        lv_anim_set_var(&a, track_);
        lv_anim_set_values(&a, 0, -(contentWidth_ + kTail));
        lv_anim_set_time(&a, (contentWidth_ + kTail) * 25);
        lv_anim_set_path_cb(&a, lv_anim_path_linear);
        lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
        lv_anim_set_repeat_delay(&a, 700);  // pause between cycles
        lv_anim_set_exec_cb(&a, [](void* var, int32_t v) {
            lv_obj_set_x(static_cast<lv_obj_t*>(var), v);
        });
        lv_anim_start(&a);
    }

    lv_obj_t* viewport() const { return viewport_; }

private:
    std::vector<MarqueeSegment> segments_;
    lv_obj_t*  viewport_     = nullptr;
    lv_obj_t*  track_        = nullptr;
    int        contentWidth_ = 0;
    const lv_font_t* font_   = nullptr;
};

}  // namespace howler::screens::components
