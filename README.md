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

## Regenerate embedded dictionary (optional)

The ArUco byte table is checked in at `src/generated/dict4x4_250_rot0.ts`. To refresh it with a local OpenCV install:

```bash
python -m venv .venv
.venv\Scripts\pip install opencv-contrib-python-headless
.venv\Scripts\python -c "import pathlib,cv2;b=cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_250).bytesList;p=[int(x) for r in b for x in r.flatten().tolist()[:2]];pathlib.Path('src/generated').mkdir(parents=True,exist_ok=True);pathlib.Path('src/generated/dict4x4_250_rot0.ts').write_text('export const DICT_4X4_250_ROT0_BYTES = new Uint8Array(['+','.join(map(str,p))+']);\n',encoding='utf-8')"
```

The raster pipeline is validated byte-for-byte against `cv2.aruco.CharucoBoard.generateImage` for sample sizes.
