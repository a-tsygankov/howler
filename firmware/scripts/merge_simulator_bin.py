"""Merge bootloader + partitions + app into one image for Wokwi.

Wokwi expects a single flash image starting at 0x0. esptool's
`merge_bin` command is the supported way; we wire it as a post-build
PlatformIO action only for the simulator env. The esptool.py script
lives in PIO's tool-esptoolpy package — invoke it explicitly so we
don't depend on `esptool` being importable from system Python.
"""
from __future__ import annotations
import os
import sys

Import("env")  # noqa: F821 — provided by PlatformIO

def merge(source, target, env):  # noqa: ANN001
    build_dir = env.subst("$BUILD_DIR")
    out = os.path.join(build_dir, "firmware-merged.bin")
    flash_size = env.BoardConfig().get("upload.flash_size", "16MB")
    esptool_dir = env.PioPlatform().get_package_dir("tool-esptoolpy")
    esptool_py = os.path.join(esptool_dir, "esptool.py")
    cmd = [
        '"' + env.subst("$PYTHONEXE") + '"',
        '"' + esptool_py + '"',
        "--chip", "esp32s3",
        "merge_bin",
        "-o", '"' + out + '"',
        "--flash_mode", "qio",
        "--flash_freq", "80m",
        "--flash_size", flash_size,
        "0x0000", '"' + os.path.join(build_dir, "bootloader.bin") + '"',
        "0x8000", '"' + os.path.join(build_dir, "partitions.bin") + '"',
        "0x10000", '"' + os.path.join(build_dir, "firmware.bin") + '"',
    ]
    rc = env.Execute(" ".join(cmd))
    if rc == 0:
        sys.stdout.write(f"[merge_simulator_bin] wrote {out}\n")
    else:
        sys.stderr.write(f"[merge_simulator_bin] esptool merge_bin failed (rc={rc})\n")

env.AddPostAction("$BUILD_DIR/firmware.bin", merge)  # noqa: F821
