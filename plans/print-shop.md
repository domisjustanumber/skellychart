# Print-shop mode plan

**Status:** in progress on branch `print-shop` (worktree `C:\Users\Dom\GitHub\skellychart-print-shop`), rebased onto `ui-tweaks` `509ef6f`. Done and committed: steps −1 (`593c1d9`), 0 (`b9a926e`, LF fix `033e2a6`), 0b (`524bd25`), 1 (`4dc3f73`), 2 (`7181759`), 3 (`bb3bdf6`), 4 (`5b1517f`), the rework of steps 1 and 2 for the 2026-10-28 decisions (standard sizes only, no monochrome in phase 1; `5698a35`), 5 (`93102c1`), 6 (`e5ff234`), 7 (`fb39a31`), 8a-8c (`781a0e5`), 9-10 (`a730669`), 11. Phase 1 is complete; next: a physical proof, then phase 2. Plan file: `plans/print-shop.md`. All `file:line` references are to the `ui-tweaks` code.

## Goal

Add a "Print shop" mode that makes one print-ready PDF for printing on **rigid boards** (foam board, corflute/coroplast, PVC, ACM) at walk-in chains (FedEx Office, Staples, Office Depot, Officeworks), over the counter or through their online ordering:
- one sheet at a standard rigid-board size, with a trim of at most 36 × 48 in;
- the board at exactly 1:1, with a compact banner and a white quiet zone;
- by default a page of trim + bleed with no marks; crop marks and a slug are opt-in; correct TrimBox and BleedBox;
- colour (monochrome is deferred);
- no fonts.

Pricing and specs come from rigid-board products, not paper posters or plan prints. A scanned shop board reopens the same board, in shop mode, at the same size, unit, bleed and marks. Home ("My printer") output does not change, apart from the X·Y ≤ 501 marker-limit fix (step −1) and the visually identical logo flatten (step 0b).

## Decisions (settled)

**User decisions for phase 1**
1. **It is a mode.** A segmented control, "My printer | Print shop", changes the preview, controls, summary and export.
2. **Always one sheet.** No tiling, assembly guide, join strips, tape labels or sheet header. A board that does not fit is refused: the square, X and Y controls end-stop. It is never tiled or shrunk without telling the user.
3. **Standard sizes only; the default is the smallest that fits.** There is no "Fit to chart" and no custom size. On entering shop mode (or when a link's size is unreadable or no longer fits), the size is the smallest standard size that holds the chart: the toggled unit's group is searched first, by area, then the other group; orientation and ties follow the deterministic paper tie-break (`tiling.ts:124-132`). The **mm | in toggle** follows the region by default: inches in US, CA and PR, metric everywhere else, including MX and PH.
4. **Standard sizes** are the fixed sizes the chains sell rigid boards in: 12×18, 16×20, 18×24, 24×36 and 36×48 in; A3, A2, A1, A0, B1, 450×600, 600×900 and 900×1200 mm. All of them are within the 36 in walk-in cap (see the 36 in cap); the user is told why bigger sizes are missing, and they may come later.
5. **Instructions go in two places:** a scan-landing card and a "Copy order details" note for the shop.
6. **A scanned shop board reopens in shop mode at its size.** This uses a new `t` field, not spare `p` digits (see the next section). Every shop option (size, unit, bleed, marks) round-trips in the link.
7. **Shop PDFs are pure vectors**, with no fonts: every glyph is an outlined `<path>`.
8. **Colour only in phase 1.** Today's colours: RGB arrows and logo, DeviceGray black. Monochrome is deferred (see Deferred): no chain prices a rigid board lower in B&W (see Rigid-board prices). The link's `g` letter stays in the grammar and is parsed, but it is reserved: the UI never writes it and the app ignores it.
9. **X/Y end-stop approved** (2026-10-28): in shop mode X and Y end-stop at the selected size, the 36 in trim cap and the 250-marker limit, and never change the square or distance.
10. **Quiet zone capped:** E = min(25, max(10, s/4)) mm.

**Accepted from the earlier analysis**
- **Compact banner:** skelly logo, chart info with the write-in box, and the QR. There is no instructions column. Its height is computed at runtime and never read from `originBannerStrip.generated.ts`. It spans max(board width, banner minimum width).
- **Shop sizes are never added to `PAPER_OPTIONS`.** `scripts/generate-banner-size.ts` iterates over `PAPER_OPTIONS`, and `originBannerReserveMm()` throws on any width it does not know.
- **Orientation** is never chosen by hand. It is picked by the deterministic fit and tie-break that home mode uses for paper (`tiling.ts:124-132`), and the summary shows it. The board is never transposed.
- **Marks and bleed** (see Page geometry):
  - Default: **no crop marks + standard bleed** (3 mm with the mm toggle, ⅛ in = 3.175 mm with the in toggle). Rigid flows want bleed and no marks.
  - Crop marks are opt-in: "Crop marks (trade printers that trim)".
  - Bleed is a select with a fixed list; there is no free-form entry.
  - All of it is written in the link. The link always wins. `localStorage` (inside try/catch) only seeds the bleed and marks choices for a fresh shop session.
- **Preview matches the PDF.** One shop SVG, including the outer media area with any marks and slug, feeds both the preview and the PDF.
- **Home mode is protected by a golden check of the SVG output.** PDFs are never byte-identical, because CreationDate and /ID change on every export. `check:presets`, `check:banner` and `check:home-golden` must keep passing without `--update`.
- **Black stays DeviceGray `0 g`/`0 G` in phase 1**, which shops print as K100. CMYK is phase 2.
- **No ICC profile, no OutputIntent, never claim PDF/X** for now (see Phase 2, Colour profile).
- **No version bump: shop mode ships in v2.0.0**, with `CHARUCO_PRINT_LABEL_SPEC_VERSION` staying at 2. v2 has not been published, so no printed v2 chart or link exists yet. The new layout and the `t` field are part of v2's format from the first release.

## Decision 6: can the spare paper digits do it?

**No, so they are not used.** The digits 4-9 could mark shop mode, but they cannot also hold the size and options. Shop mode needs:
- 13 standard sizes, a list that will grow;
- the toggle unit;
- the bleed and marks options.

That is at least 13 states plus a payload, against 6 free digits. Using up the digits would also leave none for future home papers. `PAPER_LINK_CODES` is fixed forever and append-only (`charucoDocUrl.ts:43-47`).

**Chosen grammar.** A new optional `t` (trim) field inside the existing packed `b` value, so `CHART_QR_PARAM_KEYS` and `mergeCharucoQrParamsInto` are unchanged:

```
b = <version>w<X>h<Y>s<mm>[p<d>][t<tail>]
tail    = <code>[m|i][<options>]
code    = SHOP_SIZE_LINK_CODES index (0-99); the unit letter appears only when the mm | in toggle
          differs from the size's own unit
options = [e | b<mm>] [c] [g]   in this fixed order; the defaults write nothing
          (no e or b)           standard bleed for the unit: 3 mm (m) or 1/8 in = 3.175 mm (i)
          e                     no bleed (exact trim)
          b<mm>                 bleed in mm, shortest form: b5, b10, b6.35, b3.175 (1/8 in with the
                                mm toggle), b3 (3 mm with the in toggle)
          c                     crop marks on (default off)
          g                     reserved (monochrome, deferred): parsed, never written, ignored
```

The link is parsed in stages: core, then size, then options. A damaged size never loses the board, and damaged options never lose the size.
- Size forms use only digits, `m` and `i`, so the tail splits at the first `b`, `c`, `e` or `g`.
- The remaining letters are reserved for future options; a new option letter must also join the split class.
- The Fit (`m`, `i`) and custom (`<W>x<H>m|i`) forms built in step 1 are removed before v2 freezes. A link carrying one parses as a bad size and opens at the default size with a notice.

```ts
// core: replaces PACKED_CHART_RE (charucoDocUrl.ts:40-41)
/^(develop|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)w(\d+)h(\d+)s(\d+(?:\.\d+)?)(?:p(\d))?(?:t(.*))?$/
// split group 6 into size and options
/^([^bceg]*)(.*)$/
// size (group 1)
/^(0|[1-9]\d?)([mi])?$/
// options (group 2)
/^(?:(e)|b(\d{1,2}(?:\.\d{1,3})?))?(c)?(g)?$/
```

Options writer and parser rules:
- The writer writes nothing for the defaults (standard bleed, no marks).
- The writer writes `e` for no bleed, never `b0`, and `b<mm>` only when the bleed differs from the unit's standard. It never writes `g`.
- The parser reads `b0` as `e`.
- The bleed range (0-25 mm) is checked in code, not the regex; any value in range is accepted, so a new select entry needs no grammar change.
- Bad options keep the size, fall back to the defaults and show a notice. A bad size opens at the default size with a notice (see Parser rules).

**Stable shop size codes.** `SHOP_SIZE_LINK_CODES` is new in v2 (no earlier meaning to keep). Codes 0-12 are assigned as below and frozen at v2's first release; new sizes are appended:

| Code | Size | Code | Size |
|---|---|---|---|
| 0 | 18×24 in | 7 | 16×20 in |
| 1 | 24×36 in | 8 | A3 |
| 2 | 36×48 in | 9 | B1 |
| 3 | A2 | 10 | 450×600 mm |
| 4 | A1 | 11 | 600×900 mm |
| 5 | A0 | 12 | 900×1200 mm |
| 6 | 12×18 in | | |

**Examples:**
- `?b=2.0.0w12h9s50t1`: 24×36 in, ⅛ in bleed, no marks
- `?b=2.0.0w12h9s50t1c`: 24×36 in, ⅛ in bleed, crop marks
- `?b=2.0.0w12h9s50t1b5`: 24×36 in, 5 mm bleed
- `?b=2.0.0w12h9s50t1e`: 24×36 in, exact trim
- `?b=2.0.0w12h9s50t1m`: 24×36 in with the mm toggle (3 mm bleed, mm readouts)
- `?b=2.0.0w12h9s50t4`: A1, 3 mm bleed
- `?b=2.0.0w12h9s50t4ib10`: A1, inch toggle (inch readouts), 10 mm bleed

**Writer rules:**
- Home mode writes only `p`, exactly as today.
- Shop mode writes only `t`.
- Numbers are written in their shortest form (`6.35`, not `6.350`).
- The parser accepts `p` and `t` together, and `t` decides the mode.
- Switching from a shop link back to home mode uses `defaultPaperId()`.

**Parser rules:**
- Range checks belong in code, not in the regex: the bleed (0-25 mm) and whether the board fits the size.
- An unknown code (for example a `t17` written by a newer table) or a malformed size opens the board in shop mode at the default size, with a notice like `qrSquareSnapped`.
- If the encoded size no longer fits the board (for example after a future layout change), the board opens at the default size with a notice.
- If no standard size fits the board, it opens in home mode with a notice.
- The board itself (X, Y, s) always reopens exactly, except links with X·Y > 501, which are clamped as in step −1.

**QR impact** (EC level M, 22 mm QR; a full link is `https://skelly.cam/c/?b=` (24 B) + version + core + tail):

| Link | Length | QR version | Module size |
|---|---|---|---|
| Default options, worst valid case (`w10h8s100t12i`; no valid shop board has two-digit X and Y with a three-digit square, so the core is at most 9 characters) | 42 B | 3 (the 3-M limit) | 0.759 mm |
| Any written option on a two-character tail, e.g. `t12ib6.35c` | 43-48 B | 4 | 0.667 mm |
| Grammar worst case, `w20h25s44t12ib6.35cg` (`g` is never written in phase 1) | 49 B | 4 (62 B limit) | 0.667 mm |
| The same with a two-digit minor and patch (`2.10.10`) | 51 B | 4 | 0.667 mm |

Any link of 42 B or less is version 3. All of these still scan easily. Default links (standard bleed, no marks) gain nothing. `check:links` asserts that the worst case stays at or below version 4.

**No version bump.** v2 is unpublished, so the `t` field joins the v2 link format before any v2 chart is printed. The version stays 2.0.0 and the spec version stays 2.
- Home output, including its QR link, is unchanged, so the banner rows and the home goldens do not move.
- **The `t` grammar and `SHOP_SIZE_LINK_CODES` freeze when v2 is published.** After that, any change to their meaning needs the major bump that `constants.ts:86-90` requires.

## Print-shop sizes

**Standard sizes.** Rigid boards come in fixed sizes per product. The toggled unit's group is listed first (inch with the in toggle, metric with the mm toggle) and the other group follows in a second optgroup; both groups always show, each sorted by area.

| Code | Name | mm | in | Group |
|---|---|---|---|---|
| 6 | 12 × 18 in (ARCH B) | 304.8 × 457.2 | 12 × 18 | Inch |
| 7 | 16 × 20 in | 406.4 × 508 | 16 × 20 | Inch |
| 0 | 18 × 24 in (ARCH C) | 457.2 × 609.6 | 18 × 24 | Inch |
| 1 | 24 × 36 in (ARCH D) | 609.6 × 914.4 | 24 × 36 | Inch |
| 2 | 36 × 48 in (ARCH E) | 914.4 × 1219.2 | 36 × 48 | Inch |
| 8 | A3 | 297 × 420 | 11.69 × 16.54 | Metric |
| 3 | A2 | 420 × 594 | 16.54 × 23.39 | Metric |
| 10 | 450 × 600 mm | 450 × 600 | 17.72 × 23.62 | Metric |
| 4 | A1 | 594 × 841 | 23.39 × 33.11 | Metric |
| 11 | 600 × 900 mm | 600 × 900 | 23.62 × 35.43 | Metric |
| 9 | B1 | 707 × 1000 | 27.83 × 39.37 | Metric |
| 5 | A0 | 841 × 1189 | 33.11 × 46.81 | Metric |
| 12 | 900 × 1200 mm | 900 × 1200 | 35.43 × 47.24 | Metric |

- NA rigid sizes are 12×18, 16×20, 18×24, 22×28, 24×36 and 36×48 in. Officeworks mounts A3-B0 plus the inch sizes; corflute A2/A1/A0; PVC up to A1; ACM 450×600 / 600×900 / 900×1200 mm.
- A3 is listed although it is also a home paper, because it is a rigid size.

These are left out on purpose:
- B0 (1000 × 1414 mm), which exceeds the 36 in cap;
- 22×28 in, which only FedEx sells;
- 11×17 in, which is a home paper.

**Dropdown order:** the toggled unit's group by area (inch with the in toggle, metric with the mm toggle), then the other group by area. The default size is the first entry, in this order, that fits the chart.

### Rigid-board prices

Single-sided, quantity 1.

**US (USD)**

| Product | 18×24 | 24×36 | 36×48 | Ordering |
|---|---|---|---|---|
| Staples direct-print foam board, 4.7 mm, no laminate | 29.99 | 59.99 | 119.99 | delivery |
| Office Depot direct-print foam board | from 29.99 | 54.99 | 109.99 | delivery |
| FedEx Poster + Foam Board, matte, no laminate | 33.72 | 67.44 | 134.88 | walk-in |
| FedEx Mounted Poster (lamination forced) | 40.99 | 69.99 | 145.99 | walk-in |
| Staples coroplast, 4 mm | 16.99 | 32.99 | 65.99 | |
| FedEx coroplast (UV direct) | 35.99 | 53.99 | 71.99 | walk-in |
| Staples PVC, 3 mm | 38.99 | 77.99 | 155.99 | |
| FedEx aluminium | 51.99 | 86.99 | none | |

**Canada (CAD, Staples Copy & Print):** foam-core-mounted matte poster 18×24 $39.49, 24×36 $70.99, 36×48 $117.99. Coroplast goes up to 24×36 only. FedEx Office has had no Canadian stores since 2017.

**Australia (AUD, Officeworks price guide, June 2023; dated, recheck before quoting)**

| Product | A2 | A1 | A0 | 36×48 in |
|---|---|---|---|---|
| 5 mm foam board + 160 gsm coated | 35 | 60 | 85 | 105 |
| 10 mm honeycomb | 49 | 84 | 119 | |
| 5 mm corflute poster | 100 | 105 | 115 | |

3 mm ACM: 450×600 $125, 600×900 $180, 900×1200 $240 (qty 1-2).

**UK:** no reliable walk-in rigid-board prices were found.

**No cheaper black and white.** No walk-in chain prices a rigid product lower in B&W: FedEx lists "Full Color" only, Office Depot "Full Color", Staples has no colour menu, and Officeworks has one price per board. The only cheaper mono route is Officeworks Plans / Board Mounted Plans, which requires image coverage ≤ 15% of the printable area ("Greyscale is the recommended colour mode"). A ChArUco board is about 70-75% black over the board area, so it is rejected there. For reference only, Officeworks paper plan prices (AUD): A0 80 gsm B&W $7.00 against colour $11.00; 160 gsm coated B&W $11 against colour $12.

### Rigid-board advice

Used by the advice copy and the order note (step 10).
- **Finish:** matte, **no lamination**. Gloss lamination causes glare, which can wash out squares and markers in camera views.
- **Substrate:**
  - 5 mm (3/16 in) foam board is the default, up to A1 / 24×36.
  - For A0 / 36×48: 10 mm honeycomb or 3 mm ACM. 5 mm foam and 3 mm PVC flex at that size, and a one-side paper facing can bow with humidity.
  - Coroplast is the cheapest; acceptable, not ideal (flute texture, flatness).
- **Which product at each chain** (avoid products that force gloss lamination):

  | Chain | Choose | Avoid | Lead time |
  |---|---|---|---|
  | Staples (US) | direct-print foam board | paper-mounted board (forced gloss laminate) | delivery only |
  | Office Depot | direct-print foam board | | direct-print: delivery only; mounted: same day / 24 h walk-in |
  | FedEx Office | Poster + Foam Board, matte, no lamination | Mounted Poster (forced lamination) | mounted and coroplast: same day / 24 h walk-in |
  | Staples (CA) | foam-core-mounted matte poster | | |
  | Officeworks | board-mounted poster on 160 gsm coated; 10 mm honeycomb or ACM at A0 | | board-mounted ~2 business days; signs 4-10; metal 5-11 |

- **Template:** online designers may fit or fill artwork to their template, which scales the board. Match the file's page size to the product template exactly and never use a fit/fill option. Measuring N squares on delivery catches any scale error.

**Units toggle.** Shop mode has an **mm | in** toggle. It sets:
- the standard bleed (3 mm or ⅛ in);
- which size group is listed, and searched for the default size, first;
- every shop readout.

The toggled unit is written in the link (the optional `m`/`i` letter after the size code), so a scanned board reopens in the unit it was printed in. Otherwise the region only sets the default: `shopUnitForRegion()` uses a new `SHOP_INCH_REGIONS` set of US, CA and PR. Every other region defaults to metric, including MX and PH.
- `shouldUseImperialWorkingDistanceUnits()` is not suitable: it is US-only, and Canadian shops sell in inches.
- `LETTER_DEFAULT_REGIONS` is not suitable either: it includes CL, CO, EC, VE and PH, where shops may sell ISO sizes.

**The 36 in walk-in cap.** The cap applies to the **trim**, not the page:
- **trim short side ≤ 914.4 mm (36 in);**
- **trim long side ≤ 1219.2 mm (48 in).**
- Bleed and crop marks may extend the page beyond it.
- Every standard size is within it; 36×48 in is exactly the cap.

Why trim-based: shops print 36×48 with bleed (FedEx Poster + Foam Board 36×48 with ⅛ in bleed; Officeworks 36×48 with 5 mm bleed = 924.4 mm wide; ACM 900×1200 + 10 mm), and direct-print rigid boards go through flatbeds, not rolls.

Consequences:
- A board that needs more than 36×48 in is refused. The square, X and Y controls end-stop at the largest that fits the selected size.
- Bleed and marks never change what fits; every standard size, 36×48 included, takes every option.
- **Tell the user why.** The size help and the end-stop hint say:

  > "Print-shop boards are limited to 36 in (914 mm) wide, the largest size most walk-in print shops (FedEx Office, Staples, Office Depot, Officeworks) print on rigid board. Larger boards need a sign shop; support for them may come later."

  The same sentence goes in the order note when the chart is within 25 mm of the cap.
- **Keep the cap as a named constant, `SHOP_TRIM_MAX_MM = [914.4, 1219.2]`**, which every standard size must satisfy. Raising it later (new, larger sizes appended with new codes) is backward-compatible. Never lower it, or printed boards stop reopening.

**What the cap allows** (on 36×48 in, valid boards only, X·Y ≤ 501; see step −1):

| Square | Largest grid | Limited by |
|---|---|---|
| 101 mm (far band minimum) | 8×11 or 11×8 | the cap |
| 50 mm | 17×23 or 23×17 | the cap |
| 45 mm | 26×19 (494 squares) | the cap |
| 44 mm or less | 20×25 (500 squares, 250 markers) | the 250-marker limit |

- Under the cap, the marker limit binds for every square ≤ 44 mm: the whole close band and the near band up to 44 mm. The trim cap alone would allow, for example, 27×35 or 36×26 at 33 mm and 40×40 at 22 mm or less. From 45 mm up, the trim cap is the limit. The 25 mm quiet-zone cap only changes squares over 100 mm, so it changes no row here.
- 975 of the 1521 grids in 2-40 × 2-40 are valid.
- A larger dictionary would lift the limit, but FreeMoCap's detector must use the same dictionary, so it is out of scope (see Deferred).

**Shop square maximum: 288 mm** (home mode stays 225 mm), as a per-profile constant `SHOP_SQUARE_MM_MAX`. It is the largest square any grid at least 3 squares on each side fits on a standard size: 3×3 on 36×48 in, (914.4 − 2·25) / 3 = 288.1.
- **Only small grids gain.** Largest square on 36×48 in (E = 25 mm, banner 28.5 mm, either orientation):

  | Grid | Largest square |
  |---|---|
  | 3×3 | 288 mm |
  | 3×4 / 4×3 | 285 / 278 mm |
  | 5×3 | 233 mm |
  | 3×5 | 228 mm |
  | 4×4 | 216 mm |
  | 7×5 | 167 mm |

- **2-wide grids would reach 380-432 mm** (2×3 380, 3×2 389, 2×2 432), but they have only 1-2 inner ChArUco corners and are no use for calibration. They don't set the maximum.
- **What changes in code:**
  - the square slider range and the band-edge fractions (`squareLengthTierBandEdgeFractions`, `charucoLayout.ts:204`);
  - `workingDistanceTierFromSquareLengthMm` (`charucoLayout.ts:194`);
  - the `gridFeasibility` scan bound (`feasibilityRules.ts:45`);
  - `snapSquareMm`.

  Each of these takes the profile.
- **Quiet-zone cap (adopted):** E = max(10, s/4) would cost 72 mm per side at 288 mm. Capping it at 25 mm is what lets 3×3 reach 288 mm (it stopped at 260 mm before) and 5×3 233 mm.

## Page geometry

All sizes in mm. s is the square length; PIXELS_PER_MM is 12.

| Item | Value |
|---|---|
| Quiet zone E (white, all four sides, inside the trim) | min(25, max(10, 0.25·s)). That is 10 mm at s ≤ 40, s/4 between, and 25 mm at s ≥ 100. The corner marker (needs 4 mm) fits inside E. |
| Compact banner height Hb | 28.5 mm at full type scale. It is limited by the QR: 22 mm QR plus the 6.5 mm gap below. It is computed at runtime. |
| Banner minimum width Wb | 95.2 mm at most: logo + 4 + widest chart-info line + 2.5 + QR 22. Measured with `helveticaTextWidthPx`. |
| Content block | W = max(X·s, Wb), H = Hb + Y·s. Centred in the trim, with the slack split evenly. The board is centred under the banner. |
| Trim | The selected standard size, in the orientation the fit picks. The content + 2E must fit inside it. |
| Bleed b (white) | From the bleed select. Default Standard: 3 mm with the mm toggle, 3.175 mm (⅛ in) with the in toggle. The bleed is blank white, so its only job is the page size. |
| Crop marks (opt-in) | 8 lines (2 per corner, on the trim edge lines), stroke 0.25 pt = 0.0882 mm (1.058 px), #000. Each runs from b to b + 6 mm outside the trim. |
| Media margin M | No marks: b (0 for exact trim). Crop marks: b + 7 mm. |
| Slug | Crop marks only. One outlined line, 6 pt (2.117 mm em). Baseline at trim bottom + b + 3.5 mm (outside the bleed), between x = trim left + 3 mm and trim right − 3 mm. Optional parts are dropped from the right until it fits. |
| Page boxes | MediaBox = trim + 2M. TrimBox = trim. BleedBox = trim + 2b. With no marks (the default), MediaBox = BleedBox; with no marks and no bleed, all three are equal. CropBox and ArtBox are not set. |

**Bleed select (fixed list):**

| Option | Bleed | For |
|---|---|---|
| Standard (default) | 3 mm (mm toggle) or ⅛ in (in toggle) | US practice ⅛ in (FedEx: "at least 1/8 in"); UK online 3 mm |
| None (exact trim) | 0 | flows trimmed to the document size |
| 5 mm | 5 mm | Officeworks board-mounted posters |
| 10 mm | 10 mm | Officeworks corflute, PVC and ACM (A2 template 440 × 614 = 10 mm per side) |
| ¼ in | 6.35 mm | some US online sign and poster sites |
| The other unit's standard | ⅛ in or 3 mm | a metric shop with an inch template, or the reverse |

No free-form entry is needed: every rigid flow found uses one of these, and the bleed is blank white. The resulting page size is shown beside the select: "File 24.25 × 36.25 in = 24 × 36 trim + ⅛ in bleed".

**Why no marks + bleed by default (rigid flows):**
- **Rigid ordering flows want page = trim + bleed, with no marks.** No rigid ordering flow asks for crop marks, and direct-to-board printers would print marks onto the board. FedEx's commercial guidance: "do not print color bars or the registration marks". Officeworks templates are page = trim + bleed, no marks. Staples gives a template with bleed (CMYK recommended, 300 dpi, PDF accepted).
- **Upload sites treat the page as the artwork** and want no marks too (Officeworks, Staples online); their bleeds are covered by the list above. Officeworks paper posters and plans are "trimmed to the full document size... No trim or registration marks are required".
- **A page that does not match the template may be stretched, fitted or filled.** So the order note and filename state the exact page size, and the note says to match the product template's page size exactly and never use a fit/fill option.
- **Crop marks stay available** for trade printers that trim by hand to marks (Prontaprint calls them "important"). On a white sheet with no marks, a person cutting by hand has nothing to cut to.
- **Canva Print is not suitable:** it re-imports PDFs as editable designs and adjusts the bleed.

**Slug text.** ASCII plus `×`, with no `·`:

`PRINT AT 100% - DO NOT SCALE | Trim 36 × 24 in (914.4 × 609.6 mm) | 12 × 9 squares | 50 mm | v2.0.0`

**Worked example:** 12 × 9 at 50 mm.
- Board 600 × 450, E = 12.5, content 600 × 478.5, content + 2E = 625 × 503.5.
- mm toggle: the metric group is searched first. A2 and 450×600 are too small either way; A1 fits landscape (841 × 594). Page with 3 mm bleed 847 × 600; with crop marks (M = 10) 861 × 614.
- in toggle: the inch group is searched first. 18×24 is too narrow (609.6 < 625); 24×36 fits landscape (36 × 24 in = 914.4 × 609.6). Page with ⅛ in bleed 36.25 × 24.25 in.
- Portrait is too narrow on both, so both are chosen landscape.

```
 media = trim + 2M          (M = b with no marks, the default; M = b + 7 mm with crop marks)
 +-------------------------------------------------------+
 |            |                             |            |
 |            |  crop marks: b .. b+6 mm    |            |
 |  ------    .  . . . bleed (b) . . . . .  .    ------  |
 |            . +-------------------------+ .            |
 |            . | TRIM        E           | .            |
 |            . |   +--------------------+| .            |
 |            . | E | [logo][info][QR]   || .   E = min(25, max(10, s/4))
 |            . |   | board X*s x Y*s    || .            |
 |            . |   | (origin marker     || .            |
 |            . |   |  inside E)         || .            |
 |            . |   +--------------------+| .            |
 |            . |             E           | .            |
 |            . +-------------------------+ .            |
 |  ------    .  . . . . . . . . . . . . .  .    ------  |
 |            |  PRINT AT 100% - DO NOT ... |            |
 +-------------------------------------------------------+
   (marks and slug only with crop marks on; otherwise the page ends at the bleed)
```

**PDF boxes.** These are set after `svg2pdf` on `doc.getCurrentPageInfo().pageContext` (`jspdf.es.js:3101-3103` initialises them, `2427-2432` writes them, `3608-3612` exposes the page context).
- Units are points, origin bottom-left, k = 72/25.4.
- `trimBox = {bottomLeftX: x·k, bottomLeftY: (mediaH − y − h)·k, topRightX: (x + w)·k, topRightY: (mediaH − y)·k}`, and the same for `bleedBox`.

## Pure-vector text approach

- **Font source:** Arimo Regular and Bold v1.33 from googlefonts/Arimo `fonts/ttf`, pinned at commit `4a6255f` (its repo `OFL.txt`: OFL-1.1, no Reserved Font Name). The 2020 v1.33 commit `77fdf7e` has identical outlines, but its repo `LICENSE.txt` is Apache-2.0, so it is not used. The TTFs, `OFL.txt` and a README go in `scripts/fonts/arimo/`, which is dev-only and never bundled. Its outlines and advances match Liberation Sans 2.1.5. Its advances match the Helvetica AFM within 0.5/1000 em for every glyph used.
- **Generator:** `scripts/generate-glyph-outlines.ts`, using opentype.js 1.3.4 (pinned) as a devDependency. Run it with `npm run generate:glyphs`; `npm run check:glyphs` fails when the generated file is stale, like `check:banner`. It writes `src/print/glyphOutlines.generated.ts`:
  - `GLYPH_OUTLINES {normal, bold}`: integer absolute M/L/Q/Z commands at 1000 units/em, y flipped.
  - `GLYPH_CAP_HEIGHT_EM = 0.688` and `GLYPH_X_HEIGHT_EM = 0.528`, measured from 'H' and 'x'.
  - A `/*! @license OFL-1.1 … */` header. `public/licenses/Arimo-OFL.txt` also ships. Vite drops legal comments when minifying, so `vite.config.ts` sets `build.rolldownOptions.output.comments.legal = true` (this keeps the dependencies' notices too, about 6 KB gz).
- **Glyph set:** U+0020-007E plus U+00A0, U+00B0, U+00D7 ×, U+2013 –, U+2014 —, U+2019, U+201C, U+201D.
  - Each advance must equal the `helveticaMetrics.ts` value within 0.5/1000 em, or the generator fails.
  - U+00B7 `·` is excluded (Arimo 333 against the AFM's 278), as are ¯ ± µ ÷. Shop strings use " - " and " | " instead.
- **Runtime:** `src/print/outlineText.ts` exports `outlineText(text, {x, y, fontPx, bold, anchor, baseline, fill})` and `canOutlineText()`.
  - It returns one `<path transform="matrix(s 0 0 s tx ty)" d=…>` per line, with s = fontPx/1000 (kept at full precision).
  - Glyphs are placed with the unkerned AFM advances (`helveticaTextWidthPx`), so the measured layout is exactly what is drawn.
  - Baseline offsets: `hanging` puts the baseline at y + 0.688·fontPx; `middle` at y + 0.264·fontPx.
  - It does not apply the 0.35 mm `ORIGIN_BANNER_TEXT_BASELINE_OFFSET_MM` again; that offset is already in `bannerTextTop` (`originBannerLayout.ts:132`).
  - It throws on any character missing from the table, never uses `<defs>` or `<use>`, and needs no canvas.
  - It is loaded with `await import()` from the shop renderer only, so the 21.8 KB gzipped table stays out of the home bundle.
- **The PDF has no fonts:**
  - The shop jsPDF document is built with `putOnlyUsedFonts: true`. The default (false) writes all 14 standard fonts (`jspdf.es.js:1082, 2916-2917`).
  - An empty `/Font << >>` still appears in the resource dictionaries (`2794-2803`), so checks must not grep for `/Font`.
  - With no `<text>`, `normaliseTextBaselines` (`pdfExport.ts:81-108`) returns immediately.
- **Caveat:** outlined capitals are about 4% shorter than PDF Helvetica (0.688 against 0.718), at identical widths. Accepted.

## Phase 1 implementation steps

Each step leaves the app shippable. The UI first appears at step 8a.

**−1. Fix the marker dictionary limit (an existing bug, also in home mode). Done (`593c1d9`).**
- The board uses DICT_4X4_250, so it can hold at most 250 markers. A board has floor(X·Y/2) markers, so X·Y must be ≤ 501.
- Nothing enforced this: `setGridSize` and the URL parse clamped X and Y only to 2-40, and `arucoMarkerSvgPath` read the dictionary with no bounds check, so a 40×40 board printed invalid markers.
- **Fix:** X·Y ≤ 501 is an end-stop for X and Y (each stops at floor(501/other), `boardGridAxisMax`); links keep X and clamp Y with a notice (`qrGridClamped`).
- **Checks:** `check:presets` asserts every preset obeys it and that the end-stop is exact, and sweeps only reachable grids; `arucoMarkerSvgPath` range-checks the id.

Only 975 of the 1521 grids in 2-40 × 2-40 are valid boards. Every grid count in this plan uses the valid set.

**0. Home golden check. Done (`b9a926e`, `033e2a6`).** `scripts/check-home-golden.ts` (`npm run check:home-golden`, with `--update`), already wired into `build`:
- It runs the real home pipeline (`renderCharucoPrintSvg`: board, banner, QR, logo from `public/freemocap-logo.svg`, guide) under tsx, with `cooperativeYield: false`.
- Only the tape labels' canvas measure is stubbed, with fixed Helvetica metrics.
- It covers 18 charts: every paper × the 3 distance presets, plus six multi-sheet grids with the guide.
- It writes the SHA-256 of each chart's SVGs, LF-normalised (Git checks the logo out as CRLF on Windows), to `scripts/home-golden.json`.

**0b. Logo flatten (needed for a font-free, ExtGState-free shop PDF). Done (`524bd25`).**
- In `public/freemocap-logo.svg`, path988 (`.st3`, #365D5F at opacity 0.15) had exactly the same geometry as path968 (`.st2`), with nothing painted between them.
- path988 and the `.st3` rule are deleted, and `.st2` is **#94C4C7** (0.85·#A4D6D9 + 0.15·#365D5F). It looks the same on screen.
- The Inkscape `sodipodi:namedview` (editor window state, whose `borderopacity`/`pageopacity` attributes would trip step 6's `opacity` check) is dropped too.
- Applied globally. It removes the logo's ExtGState from home PDFs too; multi-sheet home PDFs keep one, from the assembly guide's colour blocks (`fill-opacity="0.3"`, `svgAssemblyCore.ts:364`); shop mode has no guide. The golden was updated once, on purpose; every sheet is identical outside the logo markup. Banner geometry is unchanged (`check:banner` up to date).

**1. Link grammar (`src/print/charucoDocUrl.ts`). Done (`4dc3f73`), reworked (`5698a35`).**
- Built: the staged parse (core, size, options), `SHOP_SIZE_LINK_CODES` 0-12 (with the fixed-forever comment), `printMode`, `shopSize`, `shopOptions`, `shopSizeError` and `shopOptionsError` on `ParsedCharucoQrQuery`, and the `LinkTarget` writer with the positional `paperId` overload, so home callers (`main.ts:495, 601-607`, `svgDocument.ts:94-100`) emit identical URLs.
- **Reworked (`5698a35`):** dropped the Fit and custom forms from `SHOP_SIZE_RE`, `ShopSizeChoice` (now just a standard size and the toggle unit) and the writer; the size regex becomes `^(0|[1-9]\d?)([mi])?$`. The writer never writes `g`; the parser still reads it into `shopOptions` (reserved, ignored by the app).

`scripts/check-links.ts` (`check:links`, in `build`) holds a golden table covering:
- legacy `v/w/h/s/cv2` links;
- 1.x links without `p`;
- 2.0.0 `p0`-`p3`, `develop`, `0.0.0-dev` and prerelease links;
- `p4`-`p9`, which must parse as paper null in home mode;
- every size code 0-12 with and without a unit letter, and `p`+`t` together;
- every option combination on several size forms: (none), `e`, `b5`, `b10`, `b6.35`, `b3.175` (mm toggle), `b3` (in toggle), each with and without `c` and `g`; `b0` must read as `e`;
- garbled sizes (`tx`, `t24x36`, `t13`, `t17`), and the removed Fit and custom forms (`tm`, `ti`, `t841x594m`, `t24.5x36i`), which must keep w/h/s, open in shop mode with no size (the app picks the default) and set the size flag;
- garbled options (`t1bx`, `t1b99`, `t1b30`, `t1gc`, `t1eb5`), which must keep the size, fall back to the defaults (standard bleed, no marks) and set the options flag.

It also asserts the writer-to-parser round trip for every size × every bleed in the select × marks × unit, that the writer never emits `b0`, `g` or a bare default, that `w10h8s100t12i` (42 B) is QR version 3, and that the worst case (`w20h25s44t12ib6.35cg`, 49 B, and the same with version `2.10.10`) is at most version 4.

*Verify:* `check:links`, `check:home-golden`, `tsc`.

**2. Size catalogue (`src/print/shopSizes.ts`, pure, no DOM). Done (`7181759`), reworked (`5698a35`).**
- Built: `ShopSize`, `SHOP_SIZES` (codes 0-12), `shopSizeGroups()` (toggled unit first, each by area), `SHOP_TRIM_MAX_MM = [914.4, 1219.2]`, `fitsShopTrimCap()`, `shopBleedChoices()` (the fixed select list), `bleedMmForUnit()`, `pageSizeMm(trim, bleedMm, cropMarks)` = trim + 2M, `SHOP_INCH_REGIONS` and `shopUnitForRegion()`, and labels in both units (`formatShopTrim`, `shopSizeOptionLabel`, `formatShopBleed`).
- **Reworked (`5698a35`):** deleted the Fit rounding (`roundUpTrimSteps`, `roundUpTrimMm`, `shopTrimStepMm`), `shopFitCapMm`, `validateCustomTrim` and their `check:shop` cases; set `SHOP_SQUARE_MM_MAX = 288`.

`scripts/check-shop.ts` (`check:shop`, in `build`) asserts:
- codes 0-12 match the frozen table, and each group is sorted by area;
- every standard size has a short side ≤ 914.4 mm and a long side ≤ 1219.2 mm, and takes every bleed × marks option;
- page = trim + 2b with no marks and trim + 2(b + 7) with crop marks, for every bleed in the list;
- the region defaults.

**3. Glyph outlines. Done (`bb3bdf6`).**
- Files: `scripts/generate-glyph-outlines.ts`, `scripts/fonts/arimo/*`, `src/print/glyphOutlines.generated.ts`, `src/print/outlineText.ts`, `public/licenses/Arimo-OFL.txt`; `vite.config.ts` keeps legal comments.
- npm scripts `generate:glyphs` and `check:glyphs` (in `build`).

*Verified:*
- `check:glyphs`.
- `check:shop` renders sample strings and asserts: no `<text`; every glyph advances by exactly its `helveticaTextWidthPx` width (H c H against H H); the anchors and baselines; every character of every version string (dev, package, `VITE_APP_VERSION`) is in the table; `outlineText` throws on `·`.
- The OFL header is present in the minified `outlineText` chunk. Once step 6 imports it, extend `check:dist` to assert that.

**4. Compact banner (`src/print/originBannerLayout.ts`). Done (`5b1517f`).**
- Optional `variant: 'full'|'compact'` and `box: {leftPx, rightPx, topPx}`. The defaults keep today's `sheetSafeMarginsMm` path unchanged.
- In compact: no instructions; `null` if any chart-info line would wrap; bottom = max(info, QR, logo) + the gap below.
- The write-in label is centred with a `capHeightEm` param (default 0.718; the shop renderer passes `GLYPH_CAP_HEIGHT_EM`), instead of importing the generated table, so it stays out of the home bundle.
- `compactBannerMinWidthPx()` and `compactBannerHeightMm()`; the layout also returns `infoLeft`.

*Verified:* `check:banner` and `check:home-golden` unchanged; `check:shop` asserts the height is 28.5 mm for every square length up to `SHOP_SQUARE_MM_MAX`, every grid and version (one value per distinct printed width), that the minimum width is ≤ 110 mm (95.2 mm today) and exact.

**5. Shop geometry and feasibility (new `src/print/shopLayout.ts`). Done (`93102c1`).**
- With standard sizes only, shop geometry lives in its own pure module instead of threading a `SheetProfile` through the home functions (`feasibilityRules.ts`, `tiling.ts`, `charucoLayout.ts` are unchanged). Step 8 calls the shop functions in shop mode.
- Feasibility depends only on the trim, so bleed and marks are not inputs.
- `shopQuietZoneMm(s)` = min(25, max(10, s/4)); `shopBannerSizeMm()` (memoised by printed text widths).
- `shopSheetLayout(X, Y, s, sizeId)` returns `ShopLayout | null` with trim, E, banner, board and content boxes and the orientation (the page is added from the options at render time). It tries both orientations: more squares held first, then `paperOrientationPreferenceTieBreak` (`tiling.ts`), as home paper does.
- `shopValidSquaresMm`, `maxShopSquareMm`, `snapShopSquareMm` (cached per size and grid); `maxShopGridForSquare(axis, other, s, sizeId)`, which also applies X·Y ≤ 501; `smallestFittingShopSize(X, Y, s, unit)` (the default size): the first size in dropdown order whose layout is non-null, or null.
- `squareLengthTierBandEdgeFractions` and the square slider range take the shop maximum in step 8b.

*Verified:* `check:shop` checks, for every size, a sampled set of grids and every square, that:
- the content sits inside the trim with E on every side and the marker inside E;
- the reported maximum square fits and max + 1 does not (and matches the square-maximum table);
- the default size fits and no earlier size in dropdown order does;
- the valid squares are contiguous from 10 mm;
- the largest grids match the "What the cap allows" table.

`check:presets` and `check:home-golden` stay unchanged.

**6. Shop sheet SVG (new `src/print/shopSheet.ts`; small refactors in `svgAssemblyCore.ts`, `svgUtils.ts`). Done.**
- Built as specified. `svgCornerMarker` and `svgCharucoBoardInfoBlock` take an optional `SvgTextEmitter` with `outlineText`'s signature (home output is byte-identical, per `check:home-golden`). `renderShopPrintSvg()` builds the shop link, QR and logo and refuses without the logo; `resolveLogoForPrint` is exported from `svgDocument.ts`. The slug parts are `pdfLabels.shopSlugParts`. Content is placed on whole px from the layout (sub-0.05 mm). Load `shopSheet.ts` with `await import()`, and extend `check:dist` then to assert the `@license OFL-1.1` header in the built chunk (step 8a).
- In `svgAssemblyCore.ts`, export `svgCornerMarker` (`106-129`) and `svgCharucoBoardInfoBlock` (`202-223`) with an optional `text` emitter. The default produces today's exact `<text>` markup.
- `renderShopSheetSvg({X, Y, s, layout, qr, logo, version, url, bleedMm, cropMarks})` returns `{svg, mediaMm, trimBoxMm, bleedBoxMm}`:
  - a white root;
  - a `<g translate(M)>` holding the banner (logo as at `636-640`, info, QR as at `644`), the board `<svg viewBox>` (`719-724`, uncropped) and the corner marker;
  - with crop marks, the marks and slug outside that group.
- `svgRootOuterSizeAttrsUnit()` next to `svgRootOuterSizeAttrs` (`svgUtils.ts:23-28`). It writes inches only when the media is an exact multiple of ⅛ in; otherwise mm (with crop marks, usually mm).
- Shop export refuses if the logo failed to load (`svgDocument.ts:82-83`).

*Verified:* `check:shop` renders every size × both units × every bleed in the list × {no marks, crop marks} (312 sheets), in Node, and asserts:
- no `<text`, `<tspan`, `<textPath`, `<foreignObject`, `<image`, `<use`, `font-family`, `@font-face`, `rgba(` or `opacity`;
- the root size equals the media size and the viewBox equals media × 12;
- with crop marks, the mark endpoints are at trim ± b and ± (b + 6); with no marks, there are no mark paths and no slug;
- a square is s × 12 px (1:1);
- the QR input URL parses back to X, Y, s, the size and the options.

**7. PDF export (`src/ui/pdfExport.ts`) and the PDF check. Done.**
- Built as specified; the properties come from `shopPdfProperties()` in `shopSheet.ts` (the keywords carry the chart link). `check:shop-pdf` drives the system Chrome through `playwright-core` (no browser download; `PLAYWRIGHT_CHANNEL=msedge` to switch) against a Vite server on `scripts/shop-pdf-harness/`; `npm run check:all` runs `build` then it. Deploy still runs only `build`. jsPDF writes zero as `0.`, so black reads `0. g`.
- `buildPdfBlobFromSvgPages(pages, onProgress, options?)`. Called without options, it does exactly what it does today (`125-132`).
- With `options.shop`:
  - `putOnlyUsedFonts: true`;
  - keep `PrintScaling: None`;
  - assert exactly one page and media ≤ 5080 mm (jsPDF clamps larger pages with only a warning, `jspdf.es.js:3132-3135`);
  - before `svg2pdf`, throw if `text, tspan, textPath, foreignObject, image, use` is found;
  - set the TrimBox and BleedBox after `svg2pdf`;
  - `setDocumentProperties`: title; subject `Trim 36 x 24 in (914.4 x 609.6 mm) - print at 100%, do not scale - square 50 mm`; trim is W × H as placed, toggled unit first, same order as the slug; keywords; creator `skellychart v…`.
- New `scripts/check-shop-pdf.ts` (`check:shop-pdf`) uses Playwright (devDependency) against a small Vite harness page from the start; svg2pdf under jsdom is unproven. It builds 3 sizes (A3, 24×36 in and 36×48 in) × {standard bleed (default), exact trim, 10 mm bleed, standard bleed + crop marks}, inflates the streams with node:zlib and asserts:
  - exactly one `/Type /Page`;
  - MediaBox, TrimBox and BleedBox are as computed (± 0.01 pt): MediaBox = BleedBox with no marks, all three equal at exact trim, MediaBox = BleedBox + 2 × 7 mm with crop marks;
  - no `/Type /Font`, `/FontFile`, `BT`, `Tf`, `Tj`/`TJ` or `/Subtype /Image`;
  - `/PrintScaling /None`;
  - with crop marks, the mark endpoints, mapped through a small `q`/`Q`/`cm`/`m`/`l` interpreter, sit b outside the TrimBox (proves 1:1);
  - black is `0 g`/`0 G`, and there is no `/ExtGState`;
  - the URL round-trips.

  It runs in `check:all` and before release, not in every `build`.

*Manual:* Acrobat Preflight > Page boxes and "List fonts"; `pdffonts board.pdf` prints an empty table.

**8a. Mode, default size, URL, preview, summary, export (`main.ts`, `index.html`, `strings.ts`, `style.css`). Done, with 8b and 8c in one pass.**
- As built: the mode and units are `aria-pressed` button groups (`.mode-toggle`, after the theme toggle). `defaultRegion()` is exported from `charucoLayout.ts`, so the shop unit uses the default paper's region detection. With the board untouched (`autoGrid`), entering shop mode applies the shop preset; otherwise the board keeps X, Y and its square on the smallest size that fits, shrinks the square within its band if it must (notice under the toggle), or is refused (`S.shopModeNoFit`). Shop links go through `applyShopLink()`; the notices are `S.qrShopSizeFallback`, `S.qrShopSizeNoFit`, `S.qrShopOptionsFallback` and `S.qrShopTooLarge`. `check:dist` now asserts the glyph outlines ship only in the lazily loaded `shopSheet` chunk, with their OFL notice. Verified in Chrome: presets, size, unit, bleed and crop marks, X end-stop, download (dev confirm), and the link cases.
- **State:** `AppState` (`main.ts:96-103`) gains:
  - `mode`;
  - `shopUnit` (the mm | in toggle), defaulting to `shopUnitForRegion()` (wire the region the way `defaultPaperId()` resolves it) and overridden by the link's unit; `shopUnit` is read from `shopSize.unit`, and changing the toggle rewrites `shopSize.unit`;
  - `shopSize`, defaulting to `smallestFittingShopSize()` for the board;
  - `shopBleed` (`'std'` follows the toggle, or a fixed mm value), default `'std'`;
  - `shopCropMarks`, default false;
  - `homePaperId`.

  The bleed and marks are set by the link's options, and seeded from `localStorage` only for a fresh shop session. `currentProfile()` feeds `effectiveTiling()` (`183-186`).
- **Control:** a `role=radiogroup` segmented control above `#distance` (`index.html:83`), styled as `.mode-toggle` after `.theme-toggle` (`style.css:101-142`).
- **Switching home → shop:**
  - If some standard size fits the board at its current square, switch, at the default size.
  - If one fits only at a smaller square in the same distance band, switch and snap the square down, with a visible notice.
  - If none fits even at the band minimum, refuse: the control stays on "My printer" and a message names the limit and suggests fewer squares.
  - X, Y and distance never change without telling the user.
- **Switching shop → home:** keep X, Y and s, and restore `homePaperId`.
- **URL:**
  - `syncAddressBarChartQuery` (`492-502`) writes `t` with the size and options.
  - `applyQrQueryFromLocation` (`1226-1282`) sets the mode, size and options and applies the fallbacks from the decision 6 section.
  - Add shop variants of the `qrSquareSnapped` copy (`strings.ts:78-79`), one for a bad size and one for bad options.
- **QR:** the shop renderer passes the shop link into the printed QR (`svgDocument.ts:94-100`).
- **Preview:** `runPreview` (`831-1004`) shows one `thumb-grid--single` thumbnail of the shop SVG and hides `#fullPreviewBlock`.
- **Summary** (`724-739`): "1 sheet, 24 × 36 in board (914.4 × 609.6 mm), landscape | 12 × 9 squares | 50 mm".
- **Export:** `savePdfFile` (`1034-1098`) branches to the shop path.

*Verify:* all checks pass. Manual (run skill): switch modes, open `t1`, `t1c`, `t4i` and garbled links, then check the PDF boxes in Acrobat.

**8b. Size controls and end-stops. Done.**
- **Size select:** `#shopSize` replaces `#paper` (`index.html:88-91`) in shop mode, filled like the paper select (`main.ts:707-722`), with the two groups sorted by area. There is no Fit or Custom entry.
- **Sheets stepper:** `#pagesGroup` (`105-120`) is hidden; its readout shows "Trim W × H | chart w × h".
- **Square slider:** the existing snap (`1378-1388`) end-stops at the largest square that fits the selected size (up to 288 mm).
- **X/Y:** `setGridSize` (`371-373`) clamps to `maxGridForSquare` for the selected size (approved: X/Y end-stop at the size limit and never change the square or distance).
- **Size too small for the band:** when the selected size is too small for the distance band's minimum square, show a hint like `pagesFewestHint`: "Too small for 4m+: choose a larger size".
- **Shop distance presets:** `resolveShopDistancePlan()` (decided 2026-10-28), each on its default size: close 7×5 at 32 mm (A3 / 12×18 in), near 5×3 at 100 mm (A2 / 18×24 in), far 3×5 at the largest square on the smallest size that takes it at 101 mm (103 mm on A2, 106 mm on 18×24 in). Close and near sit at the top of their bands, so the square never lands in the next band. `check:shop` asserts each fits, sits in its band and is on its default size.
- Sizes this grid cannot fit at any square are listed but disabled. Picking a size keeps the board and snaps only the square, staying in the distance band when the size allows; otherwise the band follows and a hint names the size's largest square. The largest sizes (36×48 in, 900×1200 mm) show the 36 in cap note.

*Verify:* `check:shop` asserts that every shop preset is 1 sheet on its default size with a square ≥ the band minimum (10, 33 and 101 mm), and that every valid grid has a valid square on some standard size.

**8c. Print-file options, buttons, filename, guards. Done.** The bleed select appends a link's off-list bleed rather than changing it; the readout is "File W′ × H′ = W × H trim + b bleed (+ crop-mark margin)".
- **Options**, in `#advancedSettings`:
  - **Bleed** select with the fixed list (Page geometry): Standard (3 mm or ⅛ in), None (exact trim), 5 mm (Officeworks mounted), 10 mm (Officeworks corflute/PVC/ACM), ¼ in (6.35 mm), and the other unit's standard. The page size is shown beside it, e.g. "File 24.25 × 36.25 in = 24 × 36 trim + ⅛ in bleed".
  - **Crop marks** checkbox, off by default: "Crop marks (trade printers that trim)". It adds the marks, the slug and the 7 mm mark margin.
  - Nothing is greyed out for the cap, which applies to the trim only.
- **Buttons:**
  - Hide `#btnPdf` (Print) in shop mode; `openPrintDialog` (`1152`) returns early.
  - `#btnSavePdf` becomes `btn-primary` with the label "Download print-ready PDF".
- **Filename** (`exportBasenamePrefix`, `1024-1032`): `skellychart-printshop-24x36in-12x9-50mm` or `-a1-`, then the bleed in its own unit (`-bleed3mm`, `-bleed0.125in`, `-bleed5mm`, `-bleed10mm`, `-bleed0.25in`) or `-trim` for no bleed, then `-crop` with crop marks. Example: `skellychart-printshop-24x36in-12x9-50mm-bleed0.125in-crop`.
- **Release guard:** block shop export when the version is `develop` or a prerelease, or when the QR target is not `https://skelly.cam/c/` (`qrLinkTarget.ts`). In dev builds, a confirm() allows "Export anyway (test only)".

*Verify manually:*
- the filenames;
- the default (standard bleed, no marks) gives MediaBox = BleedBox;
- no bleed and no marks gives MediaBox = TrimBox = BleedBox;
- crop marks give MediaBox = BleedBox + 2 × 7 mm;
- each option (size, unit, bleed, marks) round-trips through the link;
- Print is absent in shop mode.

**9. Scan-landing card. Done.** The card shows the scanned link's own board (before any snapping). Add `<section id="scanCard" class="banner scan-card hidden">` after `#qrVersionBanner` (`index.html:77`).
- **When it shows:** when `applyQrQueryFromLocation` finds chart params and `history.state?.skScanSeen` is unset. Then call `history.replaceState({...history.state, skScanSeen: true}, '')`.
- **Content** (`S.scanCard*`):
  - "You scanned a FreeMoCap calibration chart: X × Y squares, s mm".
  - Measuring: "Measure across as many squares as your ruler spans (at least 2), from the same edge to the same edge, divide by the count, and write the result in the box". Same-edge measuring cancels ink spread.
  - A link to `FREEMOCAP_CALIBRATION_DOCS_MULTI_CAM_URL`.
  - "Print another" and "Order from a print shop" buttons, which set the mode.
  - For shop boards: "Keep it flat and out of direct sun".
  - A dismiss button.
- Version and OpenCV warnings stay in `#qrVersionBanner`.

*Verify manually:* a fresh tab opened on a `t` link shows the card in shop mode, a reload does not, and the card can be dismissed with the keyboard.

**10. Order-details note and advice copy. Done.** The note opens with the board (grid and square), measures N = max(2, min(X, ⌊300 mm / s⌋)) squares, and switches to the honeycomb/ACM board line above 24 × 36 in. Verified in Chrome (clipboard and select-all fallback paths); Firefox not yet checked.
- In shop mode, the Print & Save panel shows a read-only block and a "Copy order details" button (`navigator.clipboard`, with a select-all fallback). The text, `S.shopOrder*`:
  - Print at 100% / actual size, no scaling, fit or fill.
  - Page size: "File is W′ × H′ = W × H trim + b bleed. Match the product template's page size exactly; never use a fit/fill option", or "No bleed; final size W × H".
  - With crop marks: "Trim to W × H at the crop marks (b bleed included)."
  - Board: matte, no lamination. 5 mm (3/16 in) foam board up to A1 / 24×36; 10 mm honeycomb or 3 mm ACM for A0 / 36×48. Coroplast is acceptable, not ideal.
  - Colour: "Black is pure K; print as supplied and do not convert colours."
  - Check on delivery: measure N squares edge to same edge; each should be s mm.
  - The 36 in cap note, when the chart is within 25 mm of the cap.
- The slug, the PDF Subject and the note must carry the same facts: 100%, trim and square size. The slug is trimmed off, and it exists only with crop marks.
- **Advice copy** (`S.printAdviceShop`, `strings.ts:65-67`, now points to the new mode; shop mode shows shop copy via `setPrintAdviceElement`, `477-489`): the Rigid-board advice above (finish, substrate, which product at each chain and its lead time, match the template), plus, with no marks: "If your shop trims by hand to crop marks, turn on Crop marks."

*Verify:* copy works in Chrome and Firefox, and the text follows size, bleed and marks changes.

**11. Version, docs, wiring. Done.** README build-checks and print-shop sections, the skill note, and the main project's memory notes (control priority rules, multi-sheet layout, print-shop mode) record the approved shop exceptions.
- No version bump (v2 is unpublished). Run `check:banner` to confirm the home banner rows did not change.
- `.claude/skills/update-banner-size/SKILL.md`: shop banners are sized at runtime, and glyphs must be regenerated (`generate:glyphs`) when the font, the glyph set or `helveticaMetrics.ts` change.
- Add a README section.
- `build` runs `check:links`, `check:glyphs`, `check:shop` and `check:home-golden` (already wired).
- Update the "Control priority rules" and "Multi-sheet print layout" memory notes with the approved shop exceptions: always 1 sheet, no guide, and X/Y end-stop at the size limit.

## Phase 2

**CMYK, with cyan added to the large black areas.** Shop only; home stays DeviceGray/RGB.
- **The build (kept as asked):** C60 M0 Y0 K100 is the standard cyan-only "cool" black, 160% total ink. It is well under the 220-250% limits for paper, wide format and RIPs. K stays 100 in every black, because carbon K gives the IR density, and CMY-only black is never used. The neutral alternative is 60/40/40/100.
- **Caveat:** on UV flatbeds, an RGB #000 converted by the RIP becomes about 300% rich black, with raised edges; DeviceCMYK C60K100 (160%) avoids that. Confirm the result on a physical proof before shipping.

| Element | CMYK |
|---|---|
| Checker squares and ArUco marker cells | C60 M0 Y0 K100 |
| Outlined banner, chart-info and slug text; x/y labels; write-in box stroke | C0 M0 Y0 K100 |
| QR modules (about 0.67-0.76 mm) | C0 M0 Y0 K100 |
| Crop marks (not Registration) | C0 M0 Y0 K100 |
| Logo outline (path966) | C0 M0 Y0 K100 |
| White fills | 0 0 0 0 |
| X arrow #A52825 | re-derive (FOGRA51 placeholder C10 M90 Y80 K30) |
| Y arrow #336C34 | re-derive (FOGRA51 placeholder C70 M20 Y80 K40) |
| Logo teal #94C4C7 | re-derive (FOGRA51 placeholder C45 M8 Y20 K0) |
| Logo coral #D95157 | re-derive (FOGRA51 placeholder C5 M80 Y55 K5) |

**Why the values differ by element.**
- Fine features (text, QR, thin rules, marks) stay K-only, so misregistration cannot fringe them. Shops ask for QR codes in 100% K.
- The cyan boost goes only on large areas, where it deepens the black.
- The arrows and logo are ICC conversions (Ghostscript/lcms2), rounded to 5% steps. Re-derive them with sRGB → GRACoL2013_CRPC6 instead of PSOcoated_v3. They sit in the margin and are not detected features.

**Colour profile.**
- **For now, do not embed an ICC profile, do not write an OutputIntent, and never claim PDF/X.** jsPDF cannot write `/Trapped` or `GTS_PDFXVersion` into Info without a post-pass, and its default `/OpenAction` may be flagged.
- Walk-in RIPs apply their own CMYK simulation (Canon) or honour output intents only when the operator enables it (Fiery), so an intent buys little.
- **If a shop or preflight ever asks:** embed `GRACoL2013_CRPC6.icc` as a DestOutputProfile (registry reference name CGATS21-2-CRPC6).
  - Licence: it may be used, embedded, exchanged and shared without restriction, but not altered or sold. FOGRA51 (PSOcoated_v3) forbids redistribution without ECI permission, so it is not used.
  - Fetch it lazily from `public/icc/`, only for shop export.
  - Add it with jsPDF hooks: create the objects in `postPutResources` (`jspdf.es.js:2879`) and write only `/OutputIntents [n 0 R]` in `putCatalog` (`3299`). Root and Info must remain the last two objects (`3307-3309`). Follow the jsPDF XMP plugin pattern (`21767-21823`). `setPdfVersion('1.4')`.

**Misregistration and ink.**
- Walk-in shops print on composite inkjet, latex, UV or toner devices, with colour-to-colour registration of about 10-40 µm. Offset tolerance is 0.10 mm (ISO 12647-2).
- A uniform cyan offset is a rigid shift that the board pose absorbs. The square pitch comes from the K layer.
- Even 0.1 mm is a few percent of the smallest marker bit (about 1.1 mm at 10 mm squares) and about 2% of a camera pixel at 3 m. It does not blur the corners that calibration measures.
- No holdback/choke is applied; a trapping RIP on an offset job handles that itself.
- **The real risks:**
  - Ink spread: black squares grow, so a ruler across one black square reads about 2δ too large. The same-edge, N-squares measuring instruction cancels this.
  - Sheen or glare: recommend matte media with no lamination.
  - RIP remapping of DeviceCMYK.
- Get one physical proof from a FedEx or Staples shop before shipping.

**How the colour calls are intercepted.**
- **Mark the rich black.** Only shop SVG gives the squares and markers a sentinel `fill="rgb(0,0,1)"`, in both places: each marker path (`src/charuco/board.ts:277`) and the board `<g>` (`board.ts:300`). Without the wrapper, the sentinel would write `0 0 0.004 rg`, so it must never appear in home or phase-1 output.
- **Add a setter wrapper** on the shop jsPDF instance only (phase 1 has none; the grey wrapper was deferred with monochrome): wrap `setFillColor`, `setDrawColor` and `setTextColor` (own properties: `jspdf.es.js:5232`, `5166`, `5296`). Every svg2pdf colour call goes through them: `1770`, `1777`, `1808`, `1854-1889`, and the initial fill at `4132`.
  - Map the rounded `r,g,b` key to four 0..1 channels, which takes jsPDF's CMYK branch (`2317-2331`).
  - Keys: `0,0,1` → `[.6,0,0,1]`, `0,0,0` → `[0,0,0,1]`, `255,255,255` → `[0,0,0,0]`, plus the arrow and logo keys.
  - Throw on any key that is not in the map, so a missed coloured element fails the export.
- **Defaults.** Construct the document with `strokeColor: '0 0 0 1 K'` and `fillColor: '0 0 0 1 k'`. Otherwise jsPDF writes `0 G` at the start of each page (`5113`, `5179`).
- **Paths that bypass the setters** must stay out of shop SVG: gradients (svg2pdf `1263`, DeviceRGB hard-coded at jsPDF `2651`), patterns (`1425-1447`), images (`3124`) and opacity below 1 or `<use>` (ExtGState, `1714-1762`).
- **Check.** `check:shop-pdf` asserts no `rg`/`RG`/`g`/`G` colour operators, no `/Shading`, `/Pattern` or `/Subtype /Image`, and no ExtGState.
- **Order note and slug** add: "Squares are C60 K100; text, QR and marks are K100 only; print CMYK as supplied; do not convert K100 to rich black."

**Deferred**
- **Monochrome** (dropped from phase 1 on 2026-10-28; no rigid cost saving). To revive:
  - a Colour | Monochrome segmented control in `#advancedSettings` ("Black & white file (greyscale only)"), stored in the link as `g` (already parsed), `-mono` filename suffix, PDF subject ` - black & white`, order-note line "Black & white file (greyscale only)";
  - a mono shop SVG: squares, markers, text, QR, write-in box, crop marks and the X/Y arrows #000 (arrows told apart by their x/y labels); logo outline #000, coral #D95157 → #808080, teal #94C4C7 → #BFBFBF (fallback: outline-only logo, path966); `check:shop` asserts every fill and stroke is `none`, #000, #808080, #BFBFBF or #FFF;
  - a grey setter wrapper on the shop jsPDF instance mapping `0,0,0` and `0,0,1` → 0, `128,128,128` → 0.5, `191,191,191` → 0.75, `255,255,255` → 1, throwing on any other key. Gotcha: jsPDF divides a single numeric grey by 255 (`2280-2293`); pass 0-255 numbers or the exact strings `'0'`, `'0.5'`, `'0.75'`, `'1'`;
  - `check:shop-pdf` mono assertions: no `rg`/`RG`/`k`/`K`/`sc`/`cs`; no `/DeviceRGB`, `/DeviceCMYK`, `/ICCBased`, `/OutputIntents` or `/ExtGState`; every `g`/`G` in {0, 0.5, 0.75, 1}; Acrobat Output Preview shows only the Black plate.
- **Fit to chart and custom W × H sizes** (dropped before v2 froze; standard sizes only). Adding them later means new size forms in the frozen grammar, which a v2 parser reads as a bad size (opens at the default size), so they need a major bump or a careful append.
- Two-axis (X and Y) write-in boxes.
- Sizes beyond the 36 in walk-in cap, for sign shops: a 4×8 ft sheet (48×96 in, for plywood, drywall or ACM). The earlier analysis showed that 48×96 lifts the largest grid at 101 mm from 8×11 to 11×23. Add it as a new size code with its own end-stops, a sign-shop warning and order-note copy about flatness, weight and freight.
- A larger QR on big shop boards. The banner is computed at runtime, but the QR must not go below 22 mm.
- A "K-only blacks" option, and more sizes (B0 once the cap is raised, 22×28).
- A larger ArUco dictionary to lift the 250-marker limit; FreeMoCap's detector must use the same dictionary.
- Moving home mode to outlined text (handling `·` and the guide ring labels; a separate major decision).

## Risks and open questions

**Risks**
- The approved X/Y end-stop is a new rule for shop mode: "No page cap" and "counts include guide" do not apply there. The memory notes must be updated (step 11).
- Standard size codes become permanent with the first printed board. Freeze the list and its order before release, and only append.
- Forgetting `putOnlyUsedFonts: true` on the shop path silently adds 14 fonts. `check:shop-pdf` catches it, but only when it is run.
- The OFL notice must survive minification (`vite.config.ts` keeps legal comments); ship the licence file regardless.
- A `VITE_APP_VERSION` containing a character missing from the glyph table makes `outlineText` throw. `check:shop` covers the override.
- The default size comes from the layout. A future layout change can make a link's size no longer fit; it then opens at the default size with a notice, and the board stays exact.
- Online designers may fit or fill the file to their template and scale the board. The order note's "match the template page size" line and the measure-N-squares check are the defence.
- The cheapest good direct-print foam board (Staples, Office Depot) is delivery only; same-day walk-in options are the FedEx and Office Depot mounted products, and some force gloss lamination.
- Phase-1 colour output carries RGB arrows and logo, which each RIP converts its own way. They sit in the margin, so only their hue is at stake.
- Phase 2 relies on jsPDF 4.2.1 and svg2pdf 2.8.1 internals. Pin both versions and keep the checks.

**Open questions**
None.

**Resolved (2026-10-28)**
- Shop distance presets: close 7×5 at 32 mm, near 5×3 at 100 mm, far 3×5 at the largest square on A2 / 18×24 in (step 8b).
- `check:home-golden` and its JSON stay committed for good, and run in `build`.
- X/Y end-stop at the selected size, the 36 in trim cap and the 250-marker limit: approved.
- Quiet zone: capped, E = min(25, max(10, s/4)).
- Default size: standard sizes only, no Fit or custom; the default is the smallest standard size that fits.
- Monochrome: dropped for now (see Deferred).

## Sources

- FedEx Office: https://www.office.fedex.com/default/posters.html, https://office.fedex.com/default/mounted-poster.html, https://office.fedex.com/default/corrugate-sign.html, https://office.fedex.com/default/pvc-signs.html, https://office.fedex.com/default/metal-sign.html, https://shop.fedex.com/default/mounted-poster.html, https://shop.fedex.com/default/posters.html, https://www.office.fedex.com/default/poster-types
- Staples: https://www.staples.com/services/printing/foam-boards/, https://www.staples.com/services/printing/outdoor-signs/, https://www.staples.com/services/printing/foam-boards/18-in-x-24-in/, https://www.staples.com/services/printing/foam-boards/24-in-x-36-in/no-photo/
- Office Depot: direct-print foam board, product 9629314, https://www.officedepot.com/a/products/9629314/
- The UPS Store: https://locations.theupsstore.com/ny/brooklyn/137-montague-st/poster-printing, https://locations.theupsstore.com/tn/memphis/1498-union-ave/poster-printing
- Officeworks: https://www.officeworks.com.au/print-copy/c/pcc/poster-printing, https://www.officeworks.com.au/shop/officeworks/p/a1-foam-board-5mm-white-ljpcfba1we, plans page https://www.officeworks.com.au/print-copy/p/plans-pcppplcp, price guide (June 2023) https://appsvc01-pcc-public-p-app-01.s3.ap-southeast-2.amazonaws.com/pdf/print-and-create-price-guide.pdf
- Pricing reference: https://www.gpo.gov/docs/default-source/gpoexpress-pdf-files/gpoexpress-pricing-guide_may-1-2026.pdf
- Bleed: https://www.4over4.com/faqs/signs-banners/what-bleed-should-i-include-on-my-foamcore-sign-file
- UK print services: https://www.mbe.co.uk/print/large-format, https://windsor.prontaprint.com/pages/services-posters, https://www.hants.gov.uk/hampshire-services/hantsprint/pricing/posters, https://www.bristol.ac.uk/print-services/banners-and-posters/posters/
- Wide-format printers: https://ij.manual.canon/ij/webmanual/Manual/All/PRO-4100/EN/LBGA/lbga_tp000146.html, https://www.konicaminolta.com.au/products/wide-format/wide-format-inkjet-print-systems/hp-designjet-z9-postscript-printer
- Colour profiles: https://registry.color.org/profile-registry/GRACoL2013_CRPC6, https://registry.color.org/profile-registry/PSOcoated_v3
- Rich black: https://v2.4over4.com/guide/rich-black-explained-the-cmyk-recipe, https://printplanet.com/goto/post?id=282031, https://en.wikipedia.org/wiki/Rich_black, https://primoprint.onprintshop.com/blog/cmyk-black-builds-our-suggestions-and-why/, https://blog.signmaster.co.uk/news/our-a-to-z-of-wide-format-k-is-for-black, https://www.signs101.com/threads/black-color-bleed-when-next-to-other-color.54095
- Black for QR codes and small text: https://community.adobe.com/t5/indesign-discussions/printing-in-the-us-convert-to-black-only/m-p/12946735, https://www.stationeryhq.com/pages/rich-black-vs-true-black-with-formulas-how-to-get-deep-professional-blacks-in-print
- Trapping and RIP black handling: https://helpx.adobe.com/sk/indesign/desktop/print/color-output-and-separations/set-the-trap-width-for-colors-next-to-black.html, https://oip.manual.canon/USRMA-0078-zz-CS-enUS/contents/1T0001881162.html
- Inkjet registration patents: https://patents.google.com/patent/US6450607, https://patents.google.com/patent/US6331038
- Fonts: https://github.com/googlefonts/Arimo/tree/main/fonts/ttf, https://raw.githubusercontent.com/googlefonts/Arimo/main/OFL.txt, https://raw.githubusercontent.com/liberationfonts/liberation-fonts/main/LICENSE, https://github.com/opentypejs/opentype.js
- QR capacity: https://www.qrcode.com/en/about/version.html
- Library internals: `node_modules/jspdf/dist/jspdf.es.js` (1082, 2280-2331, 2427-2432, 2794-2803, 2879, 2916-2917, 3101-3103, 3132-3135, 3299, 3307-3309, 3608-3612, 4265, 5113, 5166, 5179, 5232, 5296, 21767-21823) and `node_modules/svg2pdf.js/dist/svg2pdf.es.js` (1263, 1425-1447, 1714-1762, 1770-1889, 3124, 4132)
