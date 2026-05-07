// Result + User pickers for the mark-done flow. Both are simple list
// widgets keyed off the rotary encoder via LVGL's encoder group; on
// click we mutate App::pendingDone() and either advance to the next
// step (Result -> User) or commit the draft (User -> Dashboard).

#include "ScreenManager.h"
#include <stdio.h>
#include <stdlib.h>
#include <cmath>

namespace howler::screens {

namespace {

const howler::domain::ResultType* findResultType(
    const std::vector<howler::domain::ResultType>& types,
    const std::string& id) {
    for (const auto& t : types) if (t.id == id) return &t;
    return nullptr;
}

}  // namespace

void ScreenManager::buildResultPicker() {
    root_ = lv_obj_create(lv_scr_act());
    lv_obj_set_size(root_, LV_PCT(100), LV_PCT(100));
    lv_obj_clear_flag(root_, LV_OBJ_FLAG_SCROLLABLE);

    const auto& pending = app_.pendingDone();
    const auto* rt = findResultType(app_.resultTypes(), pending.resultTypeId);

    auto* title = lv_label_create(root_);
    if (rt) {
        char hdr[64];
        snprintf(hdr, sizeof(hdr), "%s (%s)", rt->displayName.c_str(), rt->unitName.c_str());
        lv_label_set_text(title, hdr);
    } else {
        lv_label_set_text(title, "result");
    }
    lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 8);

    if (!rt) {
        // No matching result type — let the user "skip" via press
        // and move on to the user picker.
        auto* hint = lv_label_create(root_);
        lv_label_set_text(hint, "press to skip");
        lv_obj_center(hint);
        return;
    }

    // Roller for the value. Build "min ↔ max" stops at `step`.
    auto* roller = lv_roller_create(root_);
    static char optsBuf[1024];
    optsBuf[0] = 0;
    size_t off = 0;
    const double base = rt->hasMin ? rt->minValue : 0.0;
    const double top = rt->hasMax ? rt->maxValue : (base + (rt->step * 20));
    int idx = 0, defaultIdx = 0;
    for (double v = base; v <= top + 1e-9 && off < sizeof(optsBuf) - 32; v += rt->step) {
        if (idx > 0) optsBuf[off++] = '\n';
        off += snprintf(optsBuf + off, sizeof(optsBuf) - off, "%.2f", v);
        if (rt->hasDefault && std::abs(v - rt->defaultValue) < rt->step / 2.0) {
            defaultIdx = idx;
        }
        ++idx;
    }
    optsBuf[off] = 0;
    lv_roller_set_options(roller, optsBuf, LV_ROLLER_MODE_NORMAL);
    lv_roller_set_visible_row_count(roller, 3);
    lv_roller_set_selected(roller, defaultIdx, LV_ANIM_OFF);
    lv_obj_align(roller, LV_ALIGN_CENTER, 0, 0);
    if (group_) {
        lv_group_add_obj(group_, roller);
        lv_group_focus_obj(roller);
    }

    auto* hint = lv_label_create(root_);
    lv_label_set_text(hint, "rotate to set, press to confirm");
    lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -8);

    lv_obj_add_event_cb(roller, [](lv_event_t* e) {
        if (lv_event_get_code(e) != LV_EVENT_CLICKED) return;
        auto* mgr = static_cast<ScreenManager*>(lv_event_get_user_data(e));
        auto* roll = lv_event_get_target_obj(e);
        char buf[32];
        lv_roller_get_selected_str(roll, buf, sizeof(buf));
        mgr->app().pendingDone().hasResultValue = true;
        mgr->app().pendingDone().resultValue = atof(buf);
        mgr->app().router().push(domain::ScreenId::UserPicker);
    }, LV_EVENT_CLICKED, this);
}

void ScreenManager::buildUserPicker() {
    root_ = lv_obj_create(lv_scr_act());
    lv_obj_set_size(root_, LV_PCT(100), LV_PCT(100));
    lv_obj_clear_flag(root_, LV_OBJ_FLAG_SCROLLABLE);

    auto* title = lv_label_create(root_);
    lv_label_set_text(title, "who did it?");
    lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 6);

    auto* list = lv_list_create(root_);
    lv_obj_set_size(list, LV_PCT(100), 180);
    lv_obj_align(list, LV_ALIGN_BOTTOM_MID, 0, 0);

    // First entry is always "skip" — leaves userId empty so the
    // server records the execution without attribution.
    auto* skip = lv_list_add_btn(list, LV_SYMBOL_MINUS, "skip");
    if (group_) lv_group_add_obj(group_, skip);
    lv_obj_add_event_cb(skip, [](lv_event_t* e) {
        if (lv_event_get_code(e) != LV_EVENT_CLICKED) return;
        auto* mgr = static_cast<ScreenManager*>(lv_event_get_user_data(e));
        mgr->app().pendingDone().userId.clear();
        mgr->app().commitPendingDone();
        mgr->app().router().replaceRoot(domain::ScreenId::Dashboard);
    }, LV_EVENT_CLICKED, this);

    for (const auto& u : app_.users()) {
        auto* btn = lv_list_add_btn(list, LV_SYMBOL_OK,
            u.displayName.empty() ? u.id.c_str() : u.displayName.c_str());
        if (group_) lv_group_add_obj(group_, btn);
        // Stash the user id on the button so the click handler can
        // pull it out without a separate map. LVGL accepts arbitrary
        // user_data per object via lv_obj_set_user_data.
        auto* idCopy = static_cast<char*>(lv_malloc(u.id.size() + 1));
        memcpy(idCopy, u.id.c_str(), u.id.size() + 1);
        lv_obj_set_user_data(btn, idCopy);
        lv_obj_add_event_cb(btn, [](lv_event_t* e) {
            if (lv_event_get_code(e) != LV_EVENT_CLICKED) return;
            auto* mgr = static_cast<ScreenManager*>(lv_event_get_user_data(e));
            auto* btn = lv_event_get_target_obj(e);
            const char* uid = static_cast<const char*>(lv_obj_get_user_data(btn));
            mgr->app().pendingDone().userId = uid ? uid : "";
            mgr->app().commitPendingDone();
            mgr->app().router().replaceRoot(domain::ScreenId::Dashboard);
        }, LV_EVENT_CLICKED, this);
    }
}

}  // namespace howler::screens
