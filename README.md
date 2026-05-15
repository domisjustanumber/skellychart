# skellychart

Static web app that renders **OpenCV-compatible ChAruCo** boards (DICT_4X4_250, default non-legacy pattern) in the browser: live preview, 1:1 PNG export, and multi-sheet PDFs with tiling matching FreeMoCap’s `charuco_board_print` layout rules.

## Develop

```bash
npm install
npm run dev
```

## Build (offline `dist/`)

```bash
npm run build
```

Serve `dist/` with any static file host; Vite is configured with `base: './'` for relative asset URLs.

## Regenerate codegen output

`npm run dev` / `npm run build` run **`npm run generate`** first, which emits only:

- `src/print/generated/` — tiling feasibility blobs (`generate:tiling-feasibility`)

The ArUco dictionary module **`src/skelly-charuco/dict4x4_250_rot0.ts`** is **checked in** and is **not** regenerated during `npm run build` (CI has no OpenCV). Refresh it on your machine with **`npm run generate:aruco-dict`** (runs `scripts/export_dict4x4_250_ts.py` via `scripts/run-export-aruco-dict.ts`) or the PowerShell/bash sync scripts below.

### Refresh dictionary data from OpenCV (optional)

The committed TypeScript module under **`src/skelly-charuco/`** holds the first two rotation-0 bytes per marker id plus **`DICT_4X4_250_SOURCE_PYTHON_VERSION`** and **`DICT_4X4_250_SOURCE_OPENCV_VERSION`** from the OpenCV/Python run that last regenerated it. Compare those to your current environment when deciding whether to re-export after an OpenCV upgrade.

Regenerate with **`scripts/export_dict4x4_250_ts.py`** (OpenCV installed), or run **`npm run generate:aruco-dict`**, which looks for a project `.venv` Python, `python`, Windows `py -3`, or **`uv run --with opencv-contrib-python-headless`**. The module exports:

- `DICT_4X4_250_SOURCE_PYTHON_VERSION`
- `DICT_4X4_250_SOURCE_OPENCV_VERSION`
- `DICT_4X4_250_ROT0_BYTES`

#### One-command sync (PowerShell or bash)

From anywhere on your machine, these scripts resolve the **repo root** from their path under `scripts/`, then **`Set-Location` / `cd`** there and run the flow. They require **`uv`**, **`npm`**, and **`npx`** (for the raster check). They run **`npm install`** only when `node_modules` is missing, create **`.venv`** with `uv` if `.venv\Scripts\python.exe` (Windows) or `.venv/bin/python` (Unix) is missing, **`uv pip install opencv-contrib-python-headless`** into that venv, run **`scripts/export_dict4x4_250_ts.py`** (writes **`src/skelly-charuco/dict4x4_250_rot0.ts`**), then **`scripts/verify_charuco_raster.py`**. They always remove **`.tmp_ts_charuco_gray.bin`** at the repo root in a **`finally`/`trap`** (including on failure). **`.venv`** is left in place for faster later runs.

**Windows (PowerShell 5.1+):**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\opencv-dict-sync.ps1
```

Run `powershell` with **`-File`** pointing at this script (a relative path is fine when your current directory is the repo root; otherwise use an **absolute** path — the script still discovers the repo root from the script file’s location). If execution policy blocks `.\scripts\opencv-dict-sync.ps1`, use **`-ExecutionPolicy Bypass`** as shown. On success you should see the verifier print a byte-for-byte **OK** line and **`OK: OpenCV dict -> TypeScript export and raster check completed.`**

You can also run `.\scripts\opencv-dict-sync.ps1` from the repo root if your execution policy allows it.

**Linux / macOS / Git Bash:**

```bash
chmod +x scripts/opencv-dict-sync.sh   # once
./scripts/opencv-dict-sync.sh
```

On Windows under Git Bash, the script expects a Unix-style `uv`-managed venv (it will use `.venv/Scripts/python.exe` when `.venv/bin/python` is not present).

#### Using [uv](https://docs.astral.sh/uv/getting-started/installation/)

One-shot (no venv to activate; uv pulls OpenCV for this command only):

```bash
uv run --with opencv-contrib-python-headless python scripts/export_dict4x4_250_ts.py
uv run --with opencv-contrib-python-headless python scripts/verify_charuco_raster.py
```

Persistent venv at `.venv/` (ignored by git):

```bash
uv venv
# Windows PowerShell: .\.venv\Scripts\Activate.ps1
# Windows cmd: .venv\Scripts\activate.bat
uv pip install opencv-contrib-python-headless
python scripts/export_dict4x4_250_ts.py
python scripts/verify_charuco_raster.py
```

`verify_charuco_raster.py` renders the same board with `cv2.aruco.CharucoBoard.generateImage` and checks it matches `renderCharucoBoardGray` from TypeScript (defaults: 640×480, 5×3 squares, 54 mm square, marker ratio 0.8; override with `--width`, `--height`, etc.). It also prints the Python/OpenCV versions recorded in `src/skelly-charuco/dict4x4_250_rot0.ts` vs the OpenCV version in the current interpreter.

Equivalently, `npm run verify:opencv-raster` runs the verifier via `uv run --with …` (install [uv](https://docs.astral.sh/uv/) first).
