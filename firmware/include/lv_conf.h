/**
 * Howler LVGL 9 configuration. Tuned for the CrowPanel 240×240 GC9A01
 * round display + rotary encoder. Plan §11 unified menu component
 * needs: lv_arc, lv_label long-scroll, encoder input, montserrat 14/22.
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

/* ── widgets ──────────────────────────────────────────────── */
#define LV_USE_ARC             1
#define LV_USE_LABEL           1
#define LV_USE_BTN             1
#define LV_USE_BUTTON          1
#define LV_USE_LIST            1
#define LV_USE_ROLLER          1
#define LV_USE_SLIDER          1
#define LV_USE_BAR             1
#define LV_USE_DROPDOWN        1
#define LV_USE_FLEX            1
#define LV_USE_QRCODE          1

/* ── fonts ────────────────────────────────────────────────── */
#define LV_FONT_MONTSERRAT_14  1
#define LV_FONT_MONTSERRAT_18  1
#define LV_FONT_MONTSERRAT_22  1
#define LV_FONT_DEFAULT        &lv_font_montserrat_14

#endif /* LV_CONF_H */
