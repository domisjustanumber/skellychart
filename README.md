# skellychart

Static web app that renders **OpenCV-compatible ChArUco** boards (DICT_4X4_250, default non-legacy pattern) in the browser: live preview, 1:1 multi-page PDF download, and browser printing with multi-sheet tiling (adapted from FreeMoCap’s `charuco_board_print`, with per-edge safe printing margins in `src/print/sheetGeometry.ts`).

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

## Build checks

`npm run build` runs these checks first:

- **`npm run check:presets`** (`scripts/check-presets.ts`): every working-distance preset must print exactly its target page count, at the largest square length that does so, and at or above the distance's minimum square length. Layout feasibility itself is computed live in the browser (`src/print/feasibilityRules.ts`).
- **`npm run check:banner`**: the committed origin-banner heights in `src/print/originBannerStrip.generated.ts` must match the banner layout. After changing banner text, type, gaps, QR or logo size, the safe printing margins, paper sizes, the square-length or grid ranges, or the version, run **`npm run generate:banner`** and commit the result (CI does this for its own version bump).
- **`npm run check:links`** (`scripts/check-links.ts`): every chart link format ever printed (legacy params, 1.x, 2.x home `p` and print-shop `t`) opens as it should, garbled links degrade without losing the board, the writer round-trips, and the longest link stays at QR version 4.
- **`npm run check:glyphs`**: `src/print/glyphOutlines.generated.ts` (the outlined print-shop text, from Arimo in `scripts/fonts/arimo/`) is up to date. After changing the font, the glyph set or `src/print/helveticaMetrics.ts`, run **`npm run generate:glyphs`** and commit the result.
- **`npm run check:shop`** (`scripts/check-shop.ts`): the print-shop size catalogue and frozen size codes, page sizes for every bleed, outlined text, the compact banner, the board geometry and end-stops, the presets, and every rendered shop sheet SVG.
- **`npm run check:home-golden`**: the home ("My printer") sheet SVGs match `scripts/home-golden.json`. Only for a deliberate change to home output, run **`npm run check:home-golden -- --update`** and commit the result.

`npm run check:all` runs the build and then **`npm run check:shop-pdf`**, which builds print-shop PDFs in Chrome (via `playwright-core`; set `PLAYWRIGHT_CHANNEL=msedge` for Edge) and checks their page boxes, crop marks, that they carry no fonts, and their link. Run it before a release.

## Print-shop mode

"Print shop" makes one print-ready PDF for a rigid board (foam board, corflute, ACM) from a walk-in print shop: one of the standard sizes the chains sell (12 × 18 in to 36 × 48 in, A3 to A0, 450 × 600 to 900 × 1200 mm), the board at exactly 1:1 under a compact banner, with a white quiet zone. The page is the trim plus a bleed (3 mm or ⅛ in by default), with optional crop marks and a slug; the PDF sets the TrimBox and BleedBox, contains no fonts (text is outlined) and is DeviceCMYK only: squares C60 K100, text, QR and marks K100, accents converted to GRACoL2013 (`SHOP_CMYK_BY_RGB` in `src/print/shopSheet.ts`). Everything, including the size and print options, round-trips in the QR link (`t` field). The plan and its decisions are in `plans/print-shop.md`.

## ArUco dictionary data

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
