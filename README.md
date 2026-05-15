# skellychart

Static web app that renders **OpenCV-compatible ChaRuCo** boards (DICT_4X4_250, default non-legacy pattern) in the browser: live preview, 1:1 PNG export, and multi-sheet PDFs with tiling matching FreeMoCap’s `charuco_board_print` layout rules.

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

`npm run dev` / `npm run build` run **`npm run generate`** first, which emits:

- `src/print/generated/` — tiling feasibility blobs (`generate:tiling-feasibility`)
- `src/generated/dict4x4_250_rot0.ts` — OpenCV `DICT_4X4_250` marker bytes (`generate:aruco-dict`), using the canonical numbers in `scripts/data/dict4x4_250_rot0_first2.json`

### Refresh dictionary data from OpenCV (optional)

To update `scripts/data/dict4x4_250_rot0_first2.json` from a local OpenCV install, then re-emit the `.ts` file:

```bash
python -m venv .venv
.venv\Scripts\pip install opencv-contrib-python-headless
.venv\Scripts\python -c "import json,pathlib,cv2;b=cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_250).bytesList;p=[int(x) for r in b for x in r.flatten().tolist()[:2]];pathlib.Path('scripts/data').mkdir(parents=True,exist_ok=True);pathlib.Path('scripts/data/dict4x4_250_rot0_first2.json').write_text(json.dumps(p));print(len(p),'bytes')"
npm run generate:aruco-dict
```

The raster pipeline is validated byte-for-byte against `cv2.aruco.CharucoBoard.generateImage` for sample sizes.
