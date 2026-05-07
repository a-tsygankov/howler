#include "ScreenManager.h"
#include <stdio.h>

namespace howler::screens {

void ScreenManager::buildTaskList() {
    root_ = lv_obj_create(lv_scr_act());
    lv_obj_set_size(root_, LV_PCT(100), LV_PCT(100));
    lv_obj_clear_flag(root_, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_bg_color(root_, lv_color_make(0xFB, 0xF7, 0xEC), 0);

    auto* list = lv_list_create(root_);
    lv_obj_set_size(list, LV_PCT(100), LV_PCT(100));

    auto& dash = app_.dashboard();
    if (dash.empty()) {
        lv_list_add_text(list, "no tasks");
        return;
    }
    for (const auto& it : dash.items()) {
        const char* sym = it.urgency == domain::Urgency::Urgent
            ? LV_SYMBOL_WARNING : LV_SYMBOL_OK;
        auto* btn = lv_list_add_btn(list, sym, it.title.empty() ? "(untitled)" : it.title.c_str());
        if (group_) lv_group_add_obj(group_, btn);
        lv_obj_add_event_cb(btn, [](lv_event_t* e) {
            if (lv_event_get_code(e) != LV_EVENT_CLICKED) return;
            // Click on the encoder is bridged into LVGL via the
            // group; the manager's own onEvent path also handles
            // press but only if no widget consumed it. For the list
            // we want LVGL to win — pop back to dashboard on click
            // and let the user re-focus there.
            auto* mgr = static_cast<ScreenManager*>(lv_event_get_user_data(e));
            mgr->app().router().pop();
        }, LV_EVENT_CLICKED, this);
    }
}

void ScreenManager::buildTaskDetail() {
    // Reserved for the future "row → detail" path; for now the
    // dashboard press goes straight into the mark-done flow. Render
    // an explanatory placeholder so the screen doesn't 404.
    root_ = lv_obj_create(lv_scr_act());
    lv_obj_set_size(root_, LV_PCT(100), LV_PCT(100));
    auto* l = lv_label_create(root_);
    lv_label_set_text(l, "task detail\n(long-press to go back)");
    lv_obj_center(l);
}

}  // namespace howler::screens
