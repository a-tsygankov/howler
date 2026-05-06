"""Strip LVGL's ARM-only SIMD .S files before compile.

LVGL 9 ships lv_blend_helium.S and lv_blend_neon.S unconditionally.
PlatformIO's Library Dependency Finder discovers and assembles every
source under the lib root, so on xtensa-esp32s3 these ARM asm files
fail with `unknown opcode 'typedef'` (the asm preprocessor pulls in
C headers because the file's #if guards include lv_conf_internal.h).

Run as a PIO `pre:` script — deletes the SIMD subdirs from the
already-installed package so they're never seen by the LDF.
"""
from __future__ import annotations
import os
import shutil

Import("env")  # noqa: F821 — provided by PlatformIO

PROJECT_DIR = env.subst("$PROJECT_DIR")  # noqa: F821

def strip(_source=None, _target=None, _env=None):
    libdeps = os.path.join(PROJECT_DIR, ".pio", "libdeps")
    if not os.path.isdir(libdeps):
        return
    removed = 0
    for envname in os.listdir(libdeps):
        sw_dir = os.path.join(libdeps, envname, "lvgl", "src", "draw", "sw", "blend")
        if not os.path.isdir(sw_dir):
            continue
        for sub in ("helium", "neon"):
            target = os.path.join(sw_dir, sub)
            if os.path.isdir(target):
                shutil.rmtree(target, ignore_errors=True)
                removed += 1
    if removed:
        print(f"[strip_lvgl_simd] removed {removed} SIMD dir(s)")

# Run before any compile action.
strip()
