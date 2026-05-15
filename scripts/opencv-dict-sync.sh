#!/usr/bin/env bash
# Create/update .venv with uv, export OpenCV DICT_4X4_250 to src/skelly-charuco/dict4x4_250_rot0.ts, verify raster, remove temp files.
# Requires: uv, Node.js (npm), repo dependencies (npm install).
#
# Run from repo root: ./scripts/opencv-dict-sync.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_BIN="${ROOT}/.tmp_ts_charuco_gray.bin"

cleanup() {
  rm -f "${TMP_BIN}"
}
trap cleanup EXIT

cd "${ROOT}"

if ! command -v uv >/dev/null 2>&1; then
  echo 'uv not found on PATH. Install: https://docs.astral.sh/uv/getting-started/installation/' >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo 'npm not found on PATH. Install Node.js.' >&2
  exit 1
fi

if [[ ! -d "${ROOT}/node_modules" ]]; then
  npm install
fi

VENV_PY=''
if [[ -x "${ROOT}/.venv/bin/python" ]]; then
  VENV_PY="${ROOT}/.venv/bin/python"
elif [[ -f "${ROOT}/.venv/Scripts/python.exe" ]]; then
  VENV_PY="${ROOT}/.venv/Scripts/python.exe"
else
  uv venv "${ROOT}/.venv"
  if [[ -x "${ROOT}/.venv/bin/python" ]]; then
    VENV_PY="${ROOT}/.venv/bin/python"
  elif [[ -f "${ROOT}/.venv/Scripts/python.exe" ]]; then
    VENV_PY="${ROOT}/.venv/Scripts/python.exe"
  else
    echo 'Could not find python in .venv after uv venv.' >&2
    exit 1
  fi
fi

uv pip install --python "${VENV_PY}" opencv-contrib-python-headless

"${VENV_PY}" "${ROOT}/scripts/export_dict4x4_250_ts.py"
"${VENV_PY}" "${ROOT}/scripts/verify_charuco_raster.py"

echo "OK: OpenCV dict -> TypeScript export and raster check completed."
