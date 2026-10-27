# skellychart

Static web app that renders OpenCV-compatible ChArUco boards (DICT_4X4_250, default non-legacy pattern) in the browser: live preview, 1:1 SVG page export, and browser print-to-PDF with multi-sheet tiling that follows FreeMoCap's `charuco_board_print` layout rules.

## Develop

Requires Node `^20.19` or `>=22.12` (CI uses Node 24).

```bash
npm install
npm run dev
```

In dev, printed QR codes still point at the skelly.cam short link by default; the dev-only QR link target switch selects the local server instead.

## Build

```bash
npm run build
```

Runs codegen, type-checks, builds Vite, then runs the version guardrails. Serve `dist/` with any static host; `base: './'` keeps asset URLs relative.

## Dependencies

npm dependencies are pinned to exact versions (no `^`/`~`) in `package.json`, with `package-lock.json` committed. Dependabot proposes weekly updates for npm, GitHub Actions, and the OpenCV pin in `tests/opencv-qr-test/requirements.txt`; CI builds and, when the OpenCV pin changes, runs the ArUco/QR compatibility checks before a PR can merge automatically. See [docs/dependency-updates.md](docs/dependency-updates.md).

OpenCV is tooling-only (dictionary export and raster verification), pinned in `tests/opencv-qr-test/requirements.txt`; it is not needed for `npm run dev` or `npm run build`.

## Versioning and releases

`package.json` `version` is the single version source. Vite injects it as `__APP_VERSION__` (`APP_VERSION`): release builds use it verbatim, while `npm run dev` appends `-dev.<short-sha>[.dirty]`. The printed chart banner and its QR link carry this full semver, so a sheet identifies the generator that produced it.

A **chart spec change** makes an older printed sheet incompatible or ambiguous for its consumer: sheet tiling, margins, or banner geometry; how the board is rendered (dictionary, marker ratio, square-to-marker mapping); the QR query grammar or semantics; or a printed field whose meaning changes how the sheet is assembled or used. Cosmetic copy, extra metadata, and the version string itself are not spec changes.

- **Routine releases are automatic.** Merge to `main`; the deploy workflow patch-bumps, builds, commits the bump with `[skip ci]`, and publishes to Pages. Leave `version` alone.
- **Minor and major releases are deliberate.** Set the base version in `package.json` in the commit you merge — for a major, also set `CHARUCO_PRINT_LABEL_SPEC_VERSION` in `src/print/constants.ts`. The workflow still adds a patch on top (`1.1.0` deploys as `1.1.1`), but the minor/major increment lands.
- **Only a chart spec change bumps the major.** The constant and the app major must match; `npm run check:version` (prebuild) enforces that and `package-lock.json` agreement. Compatible feature additions are minor; fixes are patches.
- `npm run check:dist` (postbuild) confirms the production bundle embeds `APP_VERSION` rather than the dev fallback or the `__APP_VERSION__` placeholder.

## Codegen

`npm run generate` (run automatically before dev/build) writes the git-ignored `src/print/generated/` tiling feasibility tables.

The ArUco dictionary module `src/skelly-charuco/dict4x4_250_rot0.ts` holds the DICT_4X4_250 marker bit patterns: the 4×4 black/white grids the renderer draws for each marker ID and OpenCV decodes. It is committed so builds and CI need no OpenCV. `tests/opencv-qr-test/requirements.txt` pins the OpenCV used by the tooling. To verify byte parity against that pin, or to refresh the dictionary after a deliberate OpenCV upgrade, see [docs/aruco-dictionary.md](docs/aruco-dictionary.md).
