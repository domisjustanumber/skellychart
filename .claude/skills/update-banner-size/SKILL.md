---
name: update-banner-size
description: Regenerate the printed chart's origin-banner height after any change to banner content or layout. Use whenever you edit the banner text (`originInstructionsTitle`, `originInstructionsBody` or `originChartInfo` in src/print/labels.ts), banner type sizes, gaps, QR or logo size (ORIGIN_BANNER_*, ORIGIN_GAP_*, MM_ORIGIN_BANNER_BELOW_GAP_MM, QR_SIZE_MM, SKELLY_TOP_HEIGHT_MM, PIXELS_PER_MM in src/print/constants.ts), the safe printing margins (MM_SAFE_* in src/print/sheetGeometry.ts), the logo (src/print/skellyLogo.ts, public/freemocap-logo.svg), the chart font (FONT in src/print/svgAssemblyCore.ts), src/print/originBannerLayout.ts, src/print/helveticaMetrics.ts, paper sizes (PAPER_OPTIONS), the square-length or grid ranges, package.json's version or a VITE_APP_VERSION override — or when `npm run check:banner` or the build reports src/print/originBannerStrip.generated.ts is stale, missing or unreadable.
---

# Update the origin-banner size

On a single-sheet chart, tiling reserves a strip above the board for the banner (logo, instructions,
chart info, QR code). The strip is exactly the banner's rendered height, with no spare line, and is
read from `src/print/originBannerStrip.generated.ts`. Regenerate that file whenever anything that
changes the banner's text or geometry changes. `npm run build` fails while it is stale; in dev a stale
table gives the wrong reserve (spare space under the banner, shrunk banner type, or an error for a new
paper size) and logs "Origin banner is … px off its reserved strip" in the console for single-sheet
charts.

Multi-sheet charts print the banner on the assembly guide sheet instead, laid out live with
`originInstructionsBodyGuide`; nothing reserves it, so editing that text needs no regeneration. Their
first chart sheet reserves no banner strip, except when a board fits on one sheet only without the
banner: that layout keeps the strip reserved (and empty), so a banner-height change can also change
the sheet count of those boards.

## Steps

1. Make the banner change.
2. Regenerate the heights:

   ```
   npm run generate:banner
   ```

   It prints one row per banner width (each paper in portrait and landscape, less that sheet's left and
   right safe margins): the height in px and mm, the instruction line count, which column sets the
   height, and `(was … mm)` on rows that changed.
3. Tell the user which sheets changed, from the `(was …)` rows, e.g. "A4 portrait: 45.75 → 49.25 mm
   (11 instruction lines)". A taller strip leaves less room for squares on the first sheet, so the
   largest square length or the sheet count for some boards may change.
4. Check nothing else broke:

   ```
   npm run check:presets && npm run check:banner && npx tsc -b
   ```

   `check:presets` confirms every working-distance preset still prints on its target sheet count at a
   large enough square.
5. Include `src/print/originBannerStrip.generated.ts` in the same commit as the banner change.

## If the script fails

- **"banner height varies with the chart"**: at that banner width, some versions, square lengths or
  grid sizes wrap the banner onto a different number of lines, so no single height is exact.
  Shorten or reword the text, or adjust the gaps, until every input gives the same height, then rerun.
  Don't pad the height to cover the tallest case: the strip must match the banner exactly.
- **"banner columns do not fit side by side"**: the chart-info block (right-aligned against the QR code)
  leaves less than the minimum width for the instructions column on that sheet. Shorten the
  chart-info text or reduce the gaps.
- **"missing or unreadable"** (from `check:banner`, e.g. after a merge conflict in the generated file):
  run `npm run generate:banner`; it rebuilds the file from scratch.

## Notes

- Heights come from `layoutOriginBanner` in `src/print/originBannerLayout.ts`, the same function the
  sheet renderer draws with, measuring text with fixed Helvetica metrics (`helveticaMetrics.ts`). The
  script runs in plain Node with no browser or installed fonts, so its result holds on every device
  and for both Print and Save as PDF.
- The chart font must stay Helvetica or a same-width face (Arial, Liberation Sans, Arimo, Nimbus Sans):
  wrapping assumes Helvetica widths.
- The script tries the dev version, the package version and any `VITE_APP_VERSION` override, every
  square length and every grid size. If you add a placeholder to `originChartInfo`, add it to
  `layoutOriginBanner`'s parameters and loop over its range in `scripts/generate-banner-size.ts` too,
  or the check will not cover it.
- Release builds regenerate automatically: the deploy workflow runs `npm run generate:banner` after
  bumping the patch version and commits the result with the version bump.
- Never edit the generated file by hand.
- Print-shop boards use the compact banner (`variant: 'compact'`), sized at runtime by
  `compactBannerHeightMm` / `compactBannerMinWidthPx`, never from the generated file; `npm run check:shop`
  asserts its height stays constant. Its text is outlined from `src/print/glyphOutlines.generated.ts`: after
  changing the chart font, the glyph set or `helveticaMetrics.ts`, also run `npm run generate:glyphs`, and add
  any new banner character to the glyph set in `scripts/generate-glyph-outlines.ts`.
