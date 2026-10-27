#!/usr/bin/env python3
"""Print OpenCV DICT_4X4_250 rotation-0 bytes as one JSON object.

Executed inside a uv-provided environment by
tests/verify-opencv-aruco-bytes.mjs. Mirrors the byte extraction in
tests/opencv-qr-test/export_dict4x4_250_ts.py: the first two bytes of each of
the 250 bytesList rows. Nothing else is written to stdout.
"""

from __future__ import annotations

import json
import platform
import sys

import cv2


def main() -> None:
    b = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_250).bytesList
    flat: list[int] = [int(x) for row in b for x in row.flatten().tolist()[:2]]
    if len(flat) != 250 * 2:
        raise SystemExit(f"expected 500 bytes, got {len(flat)}")

    json.dump(
        {
            "python": platform.python_version(),
            "opencv": cv2.__version__,
            "bytes": flat,
        },
        sys.stdout,
        separators=(",", ":"),
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
