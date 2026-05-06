/**
 * Howler LVGL 9 configuration. Phase 0 stub — copy LVGL's
 * `lv_conf_template.h` into this file once the upstream lib lands
 * via `pio pkg install` and tune from there. Plan §11 needs at
 * minimum: lv_arc, lv_label LV_LABEL_LONG_SCROLL, encoder input device.
 */
#ifndef LV_CONF_H
#define LV_CONF_H

#include <stdint.h>

#define LV_COLOR_DEPTH         16
#define LV_USE_LOG             1
#define LV_LOG_LEVEL           LV_LOG_LEVEL_WARN
#define LV_TICK_CUSTOM         1
#define LV_TICK_CUSTOM_INCLUDE "Arduino.h"
#define LV_TICK_CUSTOM_SYS_TIME_EXPR (millis())

#define LV_USE_ARC             1
#define LV_USE_LABEL           1
#define LV_USE_BTN             1
#define LV_USE_LIST            1
#define LV_FONT_MONTSERRAT_14  1
#define LV_FONT_MONTSERRAT_18  1

#endif /* LV_CONF_H */
