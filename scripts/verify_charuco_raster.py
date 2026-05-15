#!/usr/bin/env python3
"""Compare ChaRuCo raster from OpenCV generateImage to skellychart TypeScript renderCharucoBoardGray."""

from __future__ import annotations

import argparse
import os
import pathlib
import platform
import re
import shutil
import subprocess
import sys

import cv2
import numpy as np

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
DICT_TS = REPO_ROOT / "src" / "skelly-charuco" / "dict4x4_250_rot0.ts"
DUMP_TS = REPO_ROOT / "scripts" / "dump-charuco-gray.ts"


def load_ts_provenance() -> tuple[str, str]:
    text = DICT_TS.read_text(encoding="utf-8")
    m_py = re.search(
        r"DICT_4X4_250_SOURCE_PYTHON_VERSION\s*=\s*\"([^\"]*)\"",
        text,
    )
    m_cv = re.search(
        r"DICT_4X4_250_SOURCE_OPENCV_VERSION\s*=\s*\"([^\"]*)\"",
        text,
    )
    py = m_py.group(1) if m_py else "unknown"
    cv = m_cv.group(1) if m_cv else "unknown"
    return (py, cv)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--height", type=int, default=480)
    ap.add_argument("--sx", type=int, default=5, help="squares along x")
    ap.add_argument("--sy", type=int, default=3, help="squares along y")
    ap.add_argument("--square-mm", type=float, default=54.0)
    ap.add_argument("--marker-ratio", type=float, default=0.8)
    args = ap.parse_args()

    jp_py, jp_cv = load_ts_provenance()
    cur_py = platform.python_version()
    cur_cv = cv2.__version__

    print("Dictionary .ts provenance (src/skelly-charuco/dict4x4_250_rot0.ts):")
    print(f"  recorded Python : {jp_py}")
    print("  recorded OpenCV:", jp_cv)
    print("This process (verification):")
    print(f"  Python  {cur_py}")
    print("  OpenCV ", cur_cv)
    if jp_cv != "unknown" and jp_cv != cur_cv:
        print(
            "\nWarning: OpenCV version differs from recorded .ts — if the test fails, regenerate "
            "with scripts/export_dict4x4_250_ts.py (or npm run generate:aruco-dict).\n",
            file=sys.stderr,
        )

    dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_250)
    marker_mm = args.square_mm * args.marker_ratio
    board = cv2.aruco.CharucoBoard(
        (args.sx, args.sy),
        args.square_mm,
        marker_mm,
        dictionary,
    )
    cv_img = board.generateImage((args.width, args.height))
    if len(cv_img.shape) == 3:
        cv_gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)
    else:
        cv_gray = cv_img
    cv_flat = cv_gray.astype(np.uint8).ravel()

    out_bin = REPO_ROOT / ".tmp_ts_charuco_gray.bin"
    npx = shutil.which("npx")
    if npx is None and os.name == "nt":
        npx = shutil.which("npx.cmd")
    if npx is None:
        raise SystemExit("npx not found on PATH (install Node.js / npm).")
    cmd = [
        npx,
        "tsx",
        str(DUMP_TS),
        "--out",
        str(out_bin),
        "--width",
        str(args.width),
        "--height",
        str(args.height),
        "--sx",
        str(args.sx),
        "--sy",
        str(args.sy),
        "--square-mm",
        str(args.square_mm),
        "--marker-ratio",
        str(args.marker_ratio),
    ]
    subprocess.run(cmd, cwd=REPO_ROOT, check=True)
    ts_flat = np.frombuffer(out_bin.read_bytes(), dtype=np.uint8)

    if ts_flat.size != cv_flat.size:
        raise SystemExit(f"size mismatch ts={ts_flat.size} cv={cv_flat.size}")

    if np.array_equal(ts_flat, cv_flat):
        print(f"OK: {args.width}×{args.height} raster matches OpenCV byte-for-byte.")
        return

    diff = int(np.sum(ts_flat != cv_flat))
    print(f"FAIL: {diff} / {ts_flat.size} bytes differ", file=sys.stderr)
    first = int(np.argmax(ts_flat != cv_flat))
    print(
        f"first mismatch at flat index {first}: ts={int(ts_flat[first])} cv={int(cv_flat[first])}",
        file=sys.stderr,
    )
    raise SystemExit(1)


if __name__ == "__main__":
    main()
