# Print-shop mode plan

**Status:** planned, not started. Branch `print-shop`, worktree `C:\Users\Dom\GitHub\skellychart-print-shop`, based on `700d028`. Plan file: `plans/print-shop.md`.

**Rebase first.** The `ui-tweaks` work in the main checkout is still uncommitted. It adds `src/print/sheetGeometry.ts` with the per-edge `MM_SAFE_*` margins, and it changes `tiling.ts`, `svgAssemblyCore.ts`, `originBannerLayout.ts`, `originBannerStrip*.ts`, `pdfExport.ts` (`PrintScaling: None`), `main.ts`, `strings.ts`, `style.css`, `index.html`, the scripts and `SKILL.md`. Commit that work, then rebase `print-shop` onto `ui-tweaks` before writing any code. The base `700d028` still has a uniform `MM_MARGIN_SHEET = 13` and no `PrintScaling` call. All `file:line` references below are to the `ui-tweaks` code.

## Goal

Add a "Print shop" mode that makes one print-ready PDF for printing on **rigid boards** (foam board, corflute/coroplast, PVC, ACM) at walk-in chains (FedEx Office, Staples, Office Depot, Officeworks), over the counter or through their online ordering:
- one sheet, trimmed to a chosen or fitted size, with a trim of at most 36 × 48 in;
- the board at exactly 1:1, with a compact banner and a white quiet zone;
- by default a page of trim + bleed with no marks; crop marks and a slug are opt-in; correct TrimBox and BleedBox;
- colour or monochrome;
- no fonts.

Pricing and specs come from rigid-board products, not paper posters or plan prints. A scanned shop board reopens the same board, in shop mode, at the same size, unit, bleed, marks and colour. Home ("My printer") output does not change, apart from the X·Y ≤ 501 marker-limit fix (step −1) and the visually identical logo flatten (step 0b).

## Decisions (settled)

**User decisions for phase 1**
1. **It is a mode.** A segmented control, "My printer | Print shop", changes the preview, controls, summary and export.
2. **Always one sheet.** No tiling, assembly guide, join strips, tape labels or sheet header. A board that does not fit is refused: the square, X and Y controls end-stop. It is never tiled or shrunk without telling the user.
3. **The default size is "Fit to chart"**, rounded **up** to 5 mm or ¼ in, following the shop **mm | in toggle**. The region only sets the toggle's default: inches in US, CA and PR, and metric everywhere else, including MX and PH. (See open question 5.)
4. **Standard sizes** are the fixed sizes the chains sell rigid boards in: 12×18, 16×20, 18×24, 24×36 and 36×48 in; A3, A2, A1, A0, B1, 450×600, 600×900 and 900×1200 mm. There is also a Custom W × H entry. Every shop trim is capped at 36 in (see the 36 in cap); the user is told why, and bigger sizes may come later.
5. **Instructions go in two places:** a scan-landing card and a "Copy order details" note for the shop.
6. **A scanned shop board reopens in shop mode at its size.** This uses a new `t` field, not spare `p` digits (see the next section). Every shop option (size, unit, bleed, marks, colour) round-trips in the link.
7. **Shop PDFs are pure vectors**, with no fonts: every glyph is an outlined `<path>`.
8. **Colour | Monochrome toggle**, in phase 1, stored in the link (`g`). **Default Colour**: rigid boards cost the same either way (no chain has a cheaper B&W rigid price, see Rigid-board prices), and colour keeps the red/green X/Y arrow cue. Monochrome is for users who want a strictly black-and-white file (for example paper or greyscale routes).
   - Phase 1 colour = today's colours: RGB arrows and logo, DeviceGray black.
   - Phase 2 colour = CMYK.
   - Monochrome = pure DeviceGray in both phases (step 7).

**Accepted from the earlier analysis**
- **Compact banner:** skelly logo, chart info with the write-in box, and the QR. There is no instructions column. Its height is computed at runtime and never read from `originBannerStrip.generated.ts`. It spans max(board width, banner minimum width).
- **Shop sizes are never added to `PAPER_OPTIONS`.** `scripts/generate-banner-size.ts` iterates over `PAPER_OPTIONS`, and `originBannerReserveMm()` throws on any width it does not know.
- **Orientation:**
  - Standard sizes: orientation is never chosen by hand. It is picked by the deterministic fit and tie-break that home mode uses for paper (`tiling.ts:124-132`), and the summary shows it.
  - Custom: W is always horizontal, with the banner along W.
  - Fit: the trim follows the content.
  - The board is never transposed.
- **Marks and bleed** (see Page geometry):
  - Default: **no crop marks + standard bleed** (3 mm with the mm toggle, ⅛ in = 3.175 mm with the in toggle). Rigid flows want bleed and no marks.
  - Crop marks are opt-in: "Crop marks (trade printers that trim)".
  - Bleed is a select with a fixed list; there is no free-form entry.
  - All of it is written in the link. The link always wins. `localStorage` (inside try/catch) only seeds the bleed, marks and colour choices for a fresh shop session.
- **Preview matches the PDF.** One shop SVG, including the outer media area with any marks and slug, feeds both the preview and the PDF.
- **Home mode is protected by a golden check of the SVG output.** PDFs are never byte-identical, because CreationDate and /ID change on every export. `check:presets`, `check:banner` and a new `check:home-golden` must keep passing without `--update` (the one deliberate update is the logo flatten, step 0b).
- **Black stays DeviceGray `0 g`/`0 G` in phase 1**, which shops print as K100. CMYK is phase 2.
- **No ICC profile, no OutputIntent, never claim PDF/X** for now (see Phase 2, Colour profile).
- **No version bump: shop mode ships in v2.0.0**, with `CHARUCO_PRINT_LABEL_SPEC_VERSION` staying at 2. v2 has not been published, so no printed v2 chart or link exists yet. The new layout and the `t` field are part of v2's format from the first release.

## Decision 6: can the spare paper digits do it?

**Only partly, so they are not used.** The digits 4-9 could mark shop mode, but they cannot also hold the size and options. Shop mode needs:
- 2 Fit states (5 mm rounding or ¼ in rounding);
- 13 standard sizes, a list that will grow;
- custom W × H, which is two continuous values;
- the unit, bleed, marks and colour options.

That is at least 16 states plus a payload, against 6 free digits. A Fit-only code would reopen a 24×36 board as "Fit", which breaks the rule that controls match the printout. Using up the digits would also leave none for future home papers. `PAPER_LINK_CODES` is fixed forever and append-only (`charucoDocUrl.ts:43-47`).

**Chosen grammar.** A new optional `t` (trim) field inside the existing packed `b` value, so `CHART_QR_PARAM_KEYS` and `mergeCharucoQrParamsInto` are unchanged:

```
b = <version>w<X>h<Y>s<mm>[p<d>][t<tail>]
tail    = <size>[<options>]
size    = m                     Fit to chart, mm (5 mm rounding)
        | i                     Fit to chart, inches (1/4 in rounding)
        | <code>[m|i]           standard shop size, SHOP_SIZE_LINK_CODES (0-99); the unit letter
                                appears only when the mm | in toggle differs from the size's own unit
        | <W>x<H>m              custom, whole mm
        | <W>x<H>i              custom, inches in 1/4 in steps
options = [e | b<mm>] [c] [g]   in this fixed order; the defaults write nothing
          (no e or b)           standard bleed for the unit: 3 mm (m) or 1/8 in = 3.175 mm (i)
          e                     no bleed (exact trim)
          b<mm>                 bleed in mm, shortest form: b5, b10, b6.35, b3.175 (1/8 in with the
                                mm toggle), b3 (3 mm with the in toggle)
          c                     crop marks on (default off)
          g                     monochrome (grey); default colour
```

The link is parsed in stages: core, then size, then options. A damaged size never loses the board, and damaged options never lose the size.
- Size forms use only digits, `.`, `x`, `m` and `i`, so the tail splits at the first `b`, `c`, `e` or `g`.
- A size code followed by `m` or `i` is unambiguous, because the custom forms always contain an `x`.
- The remaining letters are reserved for future options; a new option letter must also join the split class.

```ts
// core: replaces PACKED_CHART_RE (charucoDocUrl.ts:40-41)
/^(develop|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)w(\d+)h(\d+)s(\d+(?:\.\d+)?)(?:p(\d))?(?:t(.*))?$/
// split group 6 into size and options
/^([^bceg]*)(.*)$/
// size (group 1)
/^(?:([mi])|(0|[1-9]\d?)([mi])?|([1-9]\d{0,3})x([1-9]\d{0,3})m|([1-9]\d{0,2}(?:\.(?:25|5|75))?)x([1-9]\d{0,2}(?:\.(?:25|5|75))?)i)$/
// options (group 2)
/^(?:(e)|b(\d{1,2}(?:\.\d{1,3})?))?(c)?(g)?$/
```

Options writer and parser rules:
- The writer writes nothing for the defaults (standard bleed, no marks, colour).
- The writer writes `e` for no bleed, never `b0`, and `b<mm>` only when the bleed differs from the unit's standard.
- The parser reads `b0` as `e`.
- The bleed range (0-25 mm) is checked in code, not the regex; any value in range is accepted, so a new select entry needs no grammar change.
- Bad options keep the size, fall back to the defaults and show a notice. A bad size opens at Fit with a notice (see Parser rules).

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
- `?b=2.0.0w12h9s50t1`: 24×36 in, ⅛ in bleed, no marks, colour
- `?b=2.0.0w12h9s50t1c`: 24×36 in, ⅛ in bleed, crop marks
- `?b=2.0.0w12h9s50t1b5`: 24×36 in, 5 mm bleed
- `?b=2.0.0w12h9s50t4ib10`: A1, inch toggle (inch readouts), 10 mm bleed
- `?b=2.0.0w12h9s50tm`: Fit, mm, 3 mm bleed
- `?b=2.0.0w12h9s50ti`: Fit, inches, ⅛ in bleed
- `?b=2.0.0w12h9s50tme`: Fit, mm, exact trim
- `?b=2.0.0w12h9s50t841x594mb10cg`: custom 841 × 594 mm, 10 mm bleed, crop marks, monochrome
- `?b=2.0.0w9h12s50t24.5x36i`: custom 24.5 × 36 in, ⅛ in bleed (needs 475 × 653.5 mm; trim 622.3 × 914.4)
- `?b=2.0.0w20h14s50t2g`: 36×48 in, ⅛ in bleed, monochrome

**Writer rules:**
- Home mode writes only `p`, exactly as today.
- Shop mode writes only `t`.
- Numbers are written in their shortest form (`24.5`, not `24.50`).
- The parser accepts `p` and `t` together, and `t` decides the mode.
- Switching from a shop link back to home mode uses `defaultPaperId()`.

**Parser rules:**
- Range checks belong in code, not in the regex: custom limits, the trim cap, bleed 0-25 mm, and size ≥ content + 2E.
- An unknown code (for example a `t17` written by a newer table) or a malformed size opens the board in shop mode at Fit, with a notice like `qrSquareSnapped`.
- If the encoded size no longer fits the board (for example after a future layout change), the board opens at Fit with a notice.
- If the board does not fit even at the Fit cap, it opens in home mode with a notice.
- The board itself (X, Y, s) always reopens exactly, except links with X·Y > 501, which are clamped as in step −1.

**QR impact** (measured with the project's qrcode library, EC level M, 22 mm QR):

| Link | Length | QR version | Module size |
|---|---|---|---|
| Fit or standard, default options, worst valid case (`w10h8s100t12i` or `w20h25s44t12i`; no valid shop board has two-digit X and Y with a three-digit square, so the core is at most 9 characters) | 42 B | 3 (the 3-M limit) | 0.759 mm |
| Two-digit standard code with a two-digit version part | over 42 B | 4 | 0.667 mm |
| Custom size | up to 51 B (`w20h25s44t35.75x47.75i`) | 4 | 0.667 mm |
| Fit or standard, longest core + options (e.g. `t12b6.35cg`, `t12ib6.35cg`) | 43-49 B | 4 | 0.667 mm |
| Worst case: `35.75x47.75i` + `b6.35cg` (with the in toggle, ⅛ in is the standard bleed and is not written) | 58 B | 4 (62 B limit) | 0.667 mm |
| mm custom worst case: `914x1219m` + `b3.175cg` | 56 B | 4 | 0.667 mm |

Any link of 42 B or less is version 3. All of these still scan easily. Default links (standard bleed, no marks, colour) gain nothing. `check:links` asserts that the worst case stays at or below version 4.

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

These are left out on purpose; Fit to chart and Custom cover them:
- B0 (1000 × 1414 mm), which exceeds the 36 in cap;
- 22×28 in, which only FedEx sells;
- 11×17 in, which is a home paper.

**Dropdown order:** "Fit to chart (W × H)" (the default), the toggled unit's group by area (inch with the in toggle, metric with the mm toggle), then the other group by area, then "Custom…".

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
- the Fit rounding unit;
- the standard bleed (3 mm or ⅛ in);
- which size group is listed first;
- the custom-size entry unit;
- every shop readout.

The toggled unit is written in the link (the `m`/`i` letters of the `t` tail), so a scanned board reopens in the unit it was printed in. Otherwise the region only sets the default: `shopUnitForRegion()` uses a new `SHOP_INCH_REGIONS` set of US, CA and PR. Every other region defaults to metric, including MX and PH.
- `shouldUseImperialWorkingDistanceUnits()` is not suitable: it is US-only, and Canadian shops sell in inches.
- `LETTER_DEFAULT_REGIONS` is not suitable either: it includes CL, CO, EC, VE and PH, where shops may sell ISO sizes.

**Fit-to-chart rounding.** Count in whole steps and convert to mm once. Labels come from the integer count.
- Metric: `n = ceil(x/5 − 1e-9)`, then trim = 5n mm.
- Inch: `q = ceil(x/6.35 − 1e-9)`, then trim = q × 25.4 / 4 mm, labelled q/4 in.

**The 36 in walk-in cap (every shop trim: Fit, standard and Custom).** The cap applies to the **trim**, not the page:
- **trim short side ≤ 914.4 mm (36 in);**
- **trim long side ≤ 1219.2 mm (48 in).**
- Bleed and crop marks may extend the page beyond it.
- Metric Fit cap: 910 × 1215 mm. Inch Fit cap: 36 × 48 in.

Why trim-based: shops print 36×48 with bleed (FedEx Poster + Foam Board 36×48 with ⅛ in bleed; Officeworks 36×48 with 5 mm bleed = 924.4 mm wide; ACM 900×1200 + 10 mm), and direct-print rigid boards go through flatbeds, not rolls.

Consequences:
- A board that needs more is refused. The square, X and Y controls end-stop at the largest that fits.
- Bleed, marks and colour never change what fits; every standard size, 36×48 included, takes every option.
- **Tell the user why.** The size help and the end-stop hint say:

  > "Print-shop boards are limited to 36 in (914 mm) wide, the largest size most walk-in print shops (FedEx Office, Staples, Office Depot, Officeworks) print on rigid board. Larger boards need a sign shop; support for them may come later."

  The same sentence goes in the order note when the chart is within 25 mm of the cap.
- **Keep the cap as a named constant, `SHOP_TRIM_MAX_MM = [914.4, 1219.2]`**, so larger sizes can be added later. Raising the cap later is backward-compatible, because Fit links store the rounding rule, not the trim. Lowering it would push printed boards back to home mode, so never lower it.

**What the cap allows** (valid boards only, X·Y ≤ 501; see step −1):

| Square | Largest grid | Limited by |
|---|---|---|
| 101 mm (far band minimum) | 8×11 | the cap |
| 50 mm | 17×23 | the cap |
| 45 mm | 26×19 (494 squares) | the cap |
| 44 mm or less | 20×25 (500 squares, 250 markers) | the 250-marker limit |

- Under the cap, the marker limit binds for every square ≤ 44 mm: the whole close band and the near band up to 44 mm. The trim cap alone would allow, for example, 26×35 or 36×26 at 33 mm and 40×40 at 22 mm or less. From 45 mm up, the trim cap is the limit.
- 975 of the 1521 grids in 2-40 × 2-40 are valid.
- A larger dictionary would lift the limit, but FreeMoCap's detector must use the same dictionary, so it is out of scope (see Deferred).

**Shop square maximum: 260 mm** (home mode stays 225 mm), as a per-profile constant `SHOP_SQUARE_MM_MAX`.
- **Only small grids gain.** Largest square, metric Fit (910 × 1215 mm); inch Fit (914.4 × 1219.2) is 0-2 mm higher, e.g. 4×3 253, 3×5 216, 7×5 161:

  | Grid | Largest square, metric Fit |
  |---|---|
  | 3×3 | 260 mm |
  | 3×4 / 4×3 | 260 / 251 mm |
  | 5×3 | 220 mm |
  | 3×5 | 215 mm |
  | 4×4 | 202 mm |
  | 7×5 | 160 mm |

  So 225 mm only limits 3×3, 3×4 and 4×3.
- **2-wide grids would reach 339-364 mm**, but they have only 1-2 inner ChArUco corners and are no use for calibration. They don't set the maximum.
- **What changes in code:**
  - the square slider range and the band-edge fractions (`squareLengthTierBandEdgeFractions`, `charucoLayout.ts:204`);
  - `workingDistanceTierFromSquareLengthMm` (`charucoLayout.ts:194`);
  - the `gridFeasibility` scan bound (`feasibilityRules.ts:45`);
  - `snapSquareMm`.

  Each of these takes the profile.
- **Lever, if more is wanted:** the quiet zone E = max(10, s/4) costs a lot at large squares (65 mm per side at 260 mm). Capping it at 25 mm would raise 3×3 to about 280-286 mm and 5×3 to 233 mm. That needs a calibration-accuracy call, so it is an open question, not adopted.

**Custom W × H.** Enter it in the toggled unit and store it in mm.

| Rule | Limit |
|---|---|
| Step | whole mm, or ¼ in (matches the link regex) |
| Minimum | content + 2E in the orientation as typed. The width is always more than 100 mm (banner minimum width + 2E); the height can be as small as 68.5 mm (2 rows at 10 mm). The error message names it: "This chart needs at least W × H". |
| Maximum | the trim cap above: short side ≤ 914.4 mm and long side ≤ 1219.2 mm. The error message shows the cap note. |

Invalid input keeps the last valid size and never shrinks the board. jsPDF clamps pages above 14400 pt (5080 mm), far beyond these limits. Shop export still asserts against that clamp instead of letting jsPDF clamp with only a warning (`jspdf.es.js:3132-3135`).

## Page geometry

All sizes in mm. s is the square length; PIXELS_PER_MM is 12.

| Item | Value |
|---|---|
| Quiet zone E (white, all four sides, inside the trim) | max(10, 0.25·s). That is 10 mm at s ≤ 40 and 56.25 mm at s = 225. The corner marker (needs 4 mm) fits inside E. |
| Compact banner height Hb | 28.5 mm at full type scale. It is limited by the QR: 22 mm QR plus the 6.5 mm gap below. It is computed at runtime. |
| Banner minimum width Wb | about 100 mm: logo 16.6 + 4 + widest chart-info line about 52 + 2.5 + QR 22. Measured with `helveticaTextWidthPx`. |
| Content block | W = max(X·s, Wb), H = Hb + Y·s. Centred in the trim, with the slack split evenly. The board is centred under the banner. |
| Trim | Fit: round_up(content + 2E). Standard or custom: the fixed size. |
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

`PRINT AT 100% - DO NOT SCALE | Trim 24.75 × 20 in (628.65 × 508 mm) | 12 × 9 squares | 50 mm | v2.0.0`

**Worked example:** 12 × 9 at 50 mm.
- Board 600 × 450, E = 12.5, content 600 × 478.5, content + 2E = 625 × 503.5.
- Fit, metric: trim 625 × 505 mm; page with 3 mm bleed 631 × 511; with crop marks (M = 10) 645 × 525.
- Fit, inch: trim 24.75 × 20 in (628.65 × 508 mm); page with ⅛ in bleed 25 × 20.25 in.
- 24×36 in is chosen landscape (914.4 × 609.6), because portrait is too narrow.

```
 media = trim + 2M          (M = b with no marks, the default; M = b + 7 mm with crop marks)
 +-------------------------------------------------------+
 |            |                             |            |
 |            |  crop marks: b .. b+6 mm    |            |
 |  ------    .  . . . bleed (b) . . . . .  .    ------  |
 |            . +-------------------------+ .            |
 |            . | TRIM        E           | .            |
 |            . |   +--------------------+| .            |
 |            . | E | [logo][info][QR]   || .   E = max(10, s/4)
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

- **Font source:** Arimo Regular and Bold v1.33 (googlefonts/Arimo `fonts/ttf`, pinned commit). Licence is OFL-1.1 with no Reserved Font Name. The TTFs and `OFL.txt` go in `scripts/fonts/arimo/`, which is dev-only and never bundled. Its outlines and advances match Liberation Sans 2.1.5. Its advances match the Helvetica AFM within 0.5/1000 em for all 95 ASCII characters.
- **Generator:** `scripts/generate-glyph-outlines.ts`, using opentype.js 1.3.4 as a devDependency. Run it with `npm run generate:glyphs`; `npm run check:glyphs` fails when the generated file is stale, like `check:banner`. It writes `src/print/glyphOutlines.generated.ts`:
  - `GLYPH_OUTLINES {normal, bold}`: integer absolute M/L/Q/Z commands at 1000 units/em, y flipped.
  - `GLYPH_CAP_HEIGHT_EM = 0.688` and `GLYPH_X_HEIGHT_EM = 0.528`, measured from 'H' and 'x'.
  - A `/*! @license OFL-1.1 … */` header. Also ship `public/licenses/Arimo-OFL.txt`, and confirm the header survives the Rolldown minifier.
- **Glyph set:** U+0020-007E plus U+00A0, U+00B0, U+00D7 ×, U+2013 –, U+2014 —, U+2019, U+201C, U+201D.
  - Each advance must equal the `helveticaMetrics.ts` value within 0.5/1000 em, or the generator fails.
  - U+00B7 `·` is excluded (Arimo 333 against the AFM's 278), as are ¯ ± µ ÷. Shop strings use " - " and " | " instead.
- **Runtime:** `src/print/outlineText.ts` exports `outlineText(text, {x, y, fontPx, bold, anchor, baseline, fill})`.
  - It returns one `<path transform="matrix(s 0 0 s tx ty)" d=…>` per line, with s = fontPx/1000.
  - Glyphs are placed with the unkerned AFM advances (`helveticaTextWidthPx`), so the measured layout is exactly what is drawn.
  - Baseline offsets: `hanging` puts the baseline at y + 0.688·fontPx; `middle` at y + 0.264·fontPx.
  - It does not apply the 0.35 mm `ORIGIN_BANNER_TEXT_BASELINE_OFFSET_MM` again; that offset is already in `bannerTextTop` (`originBannerLayout.ts:132`).
  - It throws on any character missing from the table, never uses `<defs>` or `<use>`, and needs no canvas.
  - It is loaded with `await import()` from the shop renderer only, so the roughly 17.6 KB gzipped table stays out of the home bundle.
- **The PDF has no fonts:**
  - The shop jsPDF document is built with `putOnlyUsedFonts: true`. The default (false) writes all 14 standard fonts (`jspdf.es.js:1082, 2916-2917`).
  - An empty `/Font << >>` still appears in the resource dictionaries (`2794-2803`), so checks must not grep for `/Font`.
  - With no `<text>`, `normaliseTextBaselines` (`pdfExport.ts:81-108`) returns immediately.
- **Caveat:** outlined capitals are about 4% shorter than PDF Helvetica (0.688 against 0.718), at identical widths. Accepted.

## Phase 1 implementation steps

Each step leaves the app shippable. The UI first appears at step 8a.

**−1. Fix the marker dictionary limit (an existing bug, also in home mode; best fixed on `ui-tweaks`).**
- The board uses DICT_4X4_250, so it can hold at most 250 markers. A board has floor(X·Y/2) markers, so X·Y must be ≤ 501.
- Nothing enforces this:
  - `setGridSize` clamps X and Y only to 2-40 (`main.ts:372`), and so does the URL parse (`main.ts:1259-1262`).
  - `arucoMarkerSvgPath` reads `DICT_4X4_250_ROT0_BYTES[id*2]` with no bounds check (`board.ts:251`). Only `aruco.ts:40` checks the range.
  - So a 40×40 board (800 markers) prints invalid markers today.
- **Fix:** make X·Y ≤ 501 an end-stop for X and Y (each stops at floor(501/other)), and clamp links the same way with the snapped notice.
- **Checks:** `check:presets` asserts every preset obeys it; add a range assert in `arucoMarkerSvgPath`.

Only 975 of the 1521 grids in 2-40 × 2-40 are valid boards. Every grid count in this plan uses the valid set.

**0. Rebase and set up the home golden check.** Commit `ui-tweaks`, then `git rebase ui-tweaks` in the worktree, then run `npm install` (the new worktree has no `node_modules`). Add `scripts/check-home-golden.ts` (`npm run check:home-golden`, with `--update`):
- It renders `renderCharucoPrintSvgCore` (`svgAssemblyCore.ts:527`) under tsx.
- It uses a deterministic canvas stub for tape labels (`svgAssemblyCore.ts:61-68, 456-458, 492-494`), a fixed QR fragment, the logo from `public/freemocap-logo.svg`, and `cooperativeYield: false`.
- It covers every paper × the 3 distance presets, plus several multi-sheet grids including the guide.
- It writes the SHA-256 of each SVG to `scripts/home-golden.json`.

*Verify:* `npm run check:presets && npm run check:banner && npx tsc -b && npm run check:home-golden && npm run build`.

**0b. Logo flatten (moved from phase 2; needed for monochrome, which allows no ExtGState).**
- In `public/freemocap-logo.svg`, path988 (`.st3`, #365D5F at opacity 0.15) has exactly the same geometry as path968 (`.st2`), and nothing is painted between them.
- Delete path988 and the `.st3` rule, and set `.st2` to **#94C4C7** (0.85·#A4D6D9 + 0.15·#365D5F). It looks the same on screen.
- Apply it globally. It removes the logo's ExtGState from home PDFs too (multi-sheet home PDFs keep one: the assembly guide's colour blocks use `fill-opacity="0.3"`, `svgAssemblyCore.ts:364`; shop mode has no guide). Also drop the logo's `sodipodi:namedview` (Inkscape window state, whose `borderopacity`/`pageopacity` attributes would trip step 6's `opacity` check). Run `check:home-golden --update` once, on purpose (the only intended home golden change), and the update-banner-size skill; the geometry does not change. It is not a label or layout change, so it needs no major bump.

*Verify:* `check:banner` reports up to date; the golden diff is limited to the logo; the logo has no `opacity`.

**1. Link grammar (`src/print/charucoDocUrl.ts`).**
- Add the staged parse (core, size, options) and `SHOP_SIZE_LINK_CODES` 0-12 (with the fixed-forever comment).
- Add `printMode: 'home'|'shop'`, `shopSize: ShopSizeChoice | null` and `shopOptions: {bleed: 'std' | {mm}, cropMarks: boolean, colour: 'colour'|'mono'}` to `ParsedCharucoQrQuery`, plus `shopSizeError` and `shopOptionsError` flags.
- The writer takes `LinkTarget = {kind:'home', paperId} | {kind:'shop', size, options}`. Keep the positional `paperId` overload, so the home callers (`main.ts:495, 601-607`, `svgDocument.ts:94-100`) emit identical URLs.

New `scripts/check-links.ts` (`check:links`, added to `build`) holds a golden table covering:
- legacy `v/w/h/s/cv2` links;
- 1.x links without `p`;
- 2.0.0 `p0`-`p3`, `develop`, `0.0.0-dev` and prerelease links;
- `p4`-`p9`, which must parse as paper null in home mode;
- `tm`, `ti`, every size code 0-12 with and without a unit letter, ¼ in and mm custom extremes, and `p`+`t` together;
- every option combination on every size form: (none), `e`, `b5`, `b10`, `b6.35`, `b3.175` (mm toggle), `b3` (in toggle), each with and without `c` and `g`; `b0` must read as `e`;
- garbled sizes (`tx`, `t24x36`, `t24.1x36i`), which must keep w/h/s, open in shop mode at Fit and set the size flag;
- garbled options (`t1bx`, `t1b99`, `t1b30`, `t1gc`, `t1eb5`), which must keep the size, fall back to the defaults (standard bleed, no marks, colour) and set the options flag.

It also asserts the writer-to-parser round trip for every size form × every bleed in the select × marks × colour × unit, that the writer never emits `b0` or a bare default, that `w10h8s100t12i` (42 B) is QR version 3, and that the worst case (longest inch custom + `b6.35cg`, `w20h25s44t35.75x47.75ib6.35cg`, 58 B) is at most version 4.

*Verify:* `check:links`, `check:home-golden`, `tsc`.

**2. Size catalogue (new `src/print/shopSizes.ts`, pure, no DOM).**
- `ShopSize`, `SHOP_SIZES` (codes 0-12, each group sorted by area for the dropdown), `ShopSizeChoice = {kind:'fit', unit} | {kind:'std', code, unit} | {kind:'custom', wMm, hMm, unit}`; every variant carries the toggle unit, so `t4i` and `t4` parse differently and round-trip.
- `roundUpTrim()` using integer steps.
- `SHOP_TRIM_MAX_MM = [914.4, 1219.2]` (the 36 in walk-in trim cap) and `SHOP_SQUARE_MM_MAX = 260`.
- `SHOP_BLEED_CHOICES` (the fixed select list) and `bleedMmForUnit()`; `pageSizeMm(trim, bleedMm, cropMarks)` = trim + 2M.
- `shopUnit` is the mm | in toggle; the standard bleed and the rounding take it, not the region.
- `SHOP_INCH_REGIONS` and `shopUnitForRegion()`.
- `validateCustomTrim(w, h, unit, minW, minH)`.
- Labels in both units (the `strings.ts:18-27` pattern), including the page-size readout.

New `scripts/check-shop.ts` (`check:shop`, added to `build`) asserts:
- every rounded value is an exact multiple of the step, at least the input and less than input + step;
- every Fit, standard and custom trim has a short side ≤ 914.4 mm and a long side ≤ 1219.2 mm, and every standard size takes every bleed × marks option;
- page = trim + 2b with no marks and trim + 2(b + 7) with crop marks, for every bleed in the list;
- codes 0-12 match the frozen table, and each group is sorted by area;
- the custom limits hold.

**3. Glyph outlines.**
- Files: `scripts/generate-glyph-outlines.ts`, `scripts/fonts/arimo/*`, `src/print/glyphOutlines.generated.ts`, `src/print/outlineText.ts`, `public/licenses/Arimo-OFL.txt`.
- npm scripts `generate:glyphs` and `check:glyphs`, added to `build`.

*Verify:*
- `check:glyphs`.
- `check:shop` renders sample strings and asserts: no `<text`; the path bounding-box advance equals `helveticaTextWidthPx`; every character of every version string (dev, package, `VITE_APP_VERSION`, as in `generate-banner-size.ts:62-70`) is in the table.

**4. Compact banner (`src/print/originBannerLayout.ts`).**
- Add optional `variant: 'full'|'compact'` and `box: {leftPx, rightPx, topPx}`. The defaults keep today's `sheetSafeMarginsMm` path unchanged.
- In compact:
  - drop the instructions (`189-200`);
  - return null if any chart-info line would wrap;
  - bottom = max(info, QR, logo) + the gap below;
  - centre the write-in label with `GLYPH_CAP_HEIGHT_EM` instead of the 0.718 at line 172.
- Add `compactBannerMinWidthPx()` and `compactBannerHeightMm()`.

*Verify:*
- `check:banner` reports the generated file is up to date;
- `check:home-golden` passes;
- `check:shop` asserts the height is constant (28.5 mm) for s = 10-260, grids 2-40 and all versions, and that the minimum width is ≤ 110 mm.

**5. Shop geometry and feasibility (new `src/print/shopLayout.ts`; `feasibilityRules.ts`, `tiling.ts`, `charucoLayout.ts`).**
- `SheetProfile = {kind:'home'} | {kind:'shop', size}`; `HOME_PROFILE`; `profileKey()` returns `''` for home.
- Feasibility depends only on the trim (against `SHOP_TRIM_MAX_MM`), so bleed, marks and colour are not in the profile or the cache key.
- `shopSheetLayout(X, Y, s, size, banner)` returns `ShopLayout | null`:
  - fields: trim, E, banner box, board origin, orientation (the page is added from the options at render time);
  - standard sizes try both orientations and use the `tiling.ts:124-132` tie-break.
- `printedLayout(..., profile = HOME_PROFILE)`:
  - home mode delegates exactly as now (line 21);
  - shop mode returns a `TilingInfo` with `pageCount: 1`, `npx = npy = 1`, `bannerReserveMm: Hb` and a new optional `shop?` field.
- `gridFeasibility` cache key `${profileKey}|…` (line 38).
- A trailing optional `profile` on `maxSquareMmForGridAndPages`, `snapSquareMm`, `enumerateValidSquareSizes` and `computeEffectivePrintLayout`.
- New `maxGridForSquare(axis, s, profile)`, which also applies X·Y ≤ 501.

*Verify:* `check:shop` checks, for every size, a sampled set of grids and every square, that:
- the content sits inside the trim with E on every side and the marker inside E;
- the reported maximum square fits and max + 1 does not (and matches the square-maximum table);
- the Fit trim minus one step does not fit;
- the valid squares are contiguous from 10 mm;
- the largest grids match the "What the cap allows" table.

`check:presets` and `check:home-golden` stay unchanged.

**6. Shop sheet SVG (new `src/print/shopSheet.ts`; small refactors in `svgAssemblyCore.ts`, `svgUtils.ts`).**
- In `svgAssemblyCore.ts`, export `svgCornerMarker` (`106-129`) and `svgCharucoBoardInfoBlock` (`202-223`) with an optional `text` emitter. The default produces today's exact `<text>` markup.
- `renderShopSheetSvg({X, Y, s, layout, qr, logo, version, url, bleedMm, cropMarks, colour})` returns `{svg, mediaMm, trimBoxMm, bleedBoxMm}`:
  - a white root;
  - a `<g translate(M)>` holding the banner (logo as at `636-640`, info, QR as at `644`), the board `<svg viewBox>` (`719-724`, uncropped) and the corner marker;
  - with crop marks, the marks and slug outside that group.
- **Monochrome variant** (`colour: 'mono'`), so the preview shows what prints:
  - squares, markers, text, QR, write-in box, crop marks and the X/Y arrows are #000 (the arrows are told apart by their x/y labels);
  - logo: outline #000, coral #D95157 → #808080 (0.5 grey), teal #94C4C7 → #BFBFBF (0.75 grey);
  - fallback if the greys print poorly: an outline-only logo (path966).
- `svgRootOuterSizeAttrsUnit()` next to `svgRootOuterSizeAttrs` (`svgUtils.ts:23-28`). It writes inches only when the media is an exact multiple of ⅛ in; otherwise mm (with crop marks, usually mm).
- Shop export refuses if the logo failed to load (`svgDocument.ts:82-83`).

*Verify:* `check:shop` renders every size × every bleed in the list × {no marks, crop marks} × {colour, mono}, in Node, and asserts:
- no `<text`, `<tspan`, `<textPath`, `<foreignObject`, `<image`, `<use`, `font-family`, `@font-face`, `rgba(` or `opacity`;
- the root size equals the media size and the viewBox equals media × 12;
- with crop marks, the mark endpoints are at trim ± b and ± (b + 6); with no marks, there are no mark paths and no slug;
- in mono, every fill and stroke is `none`, #000, #808080, #BFBFBF or #FFF;
- a square is s × 12 px (1:1);
- the QR input URL parses back to X, Y, s, the size and the options.

**7. PDF export (`src/ui/pdfExport.ts`) and the PDF check.**
- `buildPdfBlobFromSvgPages(pages, onProgress, options?)`. Called without options, it does exactly what it does today (`125-132`).
- With `options.shop`:
  - `putOnlyUsedFonts: true`;
  - keep `PrintScaling: None`;
  - assert exactly one page and media ≤ 5080 mm;
  - before `svg2pdf`, throw if `text, tspan, textPath, foreignObject, image, use` is found;
  - set the TrimBox and BleedBox after `svg2pdf`;
  - `setDocumentProperties`: title; subject `Trim 36 x 24 in (914.4 x 609.6 mm) - print at 100%, do not scale - square 50 mm` (plus ` - black & white` in mono); trim is W × H as placed, toggled unit first, same order as the slug; keywords; creator `skellychart v…`.
- **Grey setter wrapper** (pulled forward from phase 2, which adds the CMYK map to the same wrapper). In mono, on the shop jsPDF instance only, wrap `setFillColor`, `setDrawColor` and `setTextColor` (own properties: `jspdf.es.js:5232`, `5166`, `5296`; every svg2pdf colour call goes through them).
  - Map the rounded `r,g,b` key to a grey: `0,0,0` → 0; `0,0,1` (the phase-2 rich-black sentinel) → 0; `128,128,128` → 0.5; `191,191,191` → 0.75; `255,255,255` → 1.
  - Throw on any other key, so a missed coloured element fails the export.
  - **Gotcha:** jsPDF divides a single numeric grey by 255 (`2280-2293`). Pass 0-255 numbers (0, 127.5, 191.25, 255) or the exact strings `'0'`, `'0.5'`, `'0.75'`, `'1'`.
- New `scripts/check-shop-pdf.ts` (`check:shop-pdf`) uses Playwright (devDependency) against a small Vite harness page from the start; svg2pdf under jsdom is unproven. It builds 3 sizes (one of them Fit at the cap, one 36×48) × {standard bleed (default), exact trim, 10 mm bleed, standard bleed + crop marks} × {colour, mono}, inflates the streams with node:zlib and asserts:
  - exactly one `/Type /Page`;
  - MediaBox, TrimBox and BleedBox are as computed (± 0.01 pt): MediaBox = BleedBox with no marks, all three equal at exact trim, MediaBox = BleedBox + 2 × 7 mm with crop marks;
  - no `/Type /Font`, `/FontFile`, `BT`, `Tf`, `Tj`/`TJ` or `/Subtype /Image`;
  - `/PrintScaling /None`;
  - with crop marks, the mark endpoints, mapped through a small `q`/`Q`/`cm`/`m`/`l` interpreter, sit b outside the TrimBox (proves 1:1);
  - **mono is pure DeviceGray:** no `rg`/`RG`/`k`/`K`/`sc`/`cs` operators; no `/DeviceRGB`, `/DeviceCMYK`, `/ICCBased`, `/OutputIntents` or `/ExtGState`; no images; every `g`/`G` value is in {0, 0.5, 0.75, 1};
  - colour: black is `0 g`/`0 G`, and there is no `/ExtGState` (after step 0b);
  - the URL round-trips.

  It runs in `check:all` and before release, not in every `build`.

*Manual:* Acrobat Preflight > Page boxes and "List fonts"; `pdffonts board.pdf` prints an empty table; Acrobat Output Preview shows only the Black plate for a mono PDF.

**8a. Mode, Fit to chart, URL, preview, summary, export (`main.ts`, `index.html`, `strings.ts`, `style.css`).**
- **State:** `AppState` (`main.ts:96-103`) gains:
  - `mode`;
  - `shopUnit` (the mm | in toggle), defaulting to `shopUnitForRegion()` and overridden by the link's `m`/`i`; `shopUnit` is read from `shopSize.unit`, and changing the toggle rewrites `shopSize.unit`;
  - `shopSize`, defaulting to `{kind:'fit', unit: shopUnit}`;
  - `shopBleed` (`'std'` follows the toggle, or a fixed mm value), default `'std'`;
  - `shopCropMarks`, default false;
  - `shopColour`, default `'colour'`;
  - `homePaperId`.

  The bleed, marks and colour are set by the link's options, and seeded from `localStorage` only for a fresh shop session. `currentProfile()` feeds `effectiveTiling()` (`183-186`).
- **Control:** a `role=radiogroup` segmented control above `#distance` (`index.html:83`), styled as `.mode-toggle` after `.theme-toggle` (`style.css:101-142`).
- **Switching home → shop:**
  - If the board fits at its current square, switch.
  - If it fits only at a smaller square in the same distance band, switch and snap the square down, with a visible notice.
  - If it does not fit even at the band minimum, refuse: the control stays on "My printer" and a message names the limit and suggests fewer squares.
  - X, Y and distance never change without telling the user.
- **Switching shop → home:** keep X, Y and s, and restore `homePaperId`.
- **URL:**
  - `syncAddressBarChartQuery` (`492-502`) writes `t` with the size and options.
  - `applyQrQueryFromLocation` (`1226-1282`) sets the mode, size and options and applies the fallbacks from the decision 6 section.
  - Add shop variants of the `qrSquareSnapped` copy (`strings.ts:78-79`), one for a bad size and one for bad options.
- **QR:** the shop renderer passes the shop link into the printed QR (`svgDocument.ts:94-100`).
- **Preview:** `runPreview` (`831-1004`) shows one `thumb-grid--single` thumbnail of the shop SVG and hides `#fullPreviewBlock`.
- **Summary** (`724-739`): "1 sheet, trimmed to 24.75 × 20 in (628.65 × 508 mm), landscape | 12 × 9 squares | 50 mm".
- **Export:** `savePdfFile` (`1034-1098`) branches to the shop path.

*Verify:* all checks pass. Manual (run skill): switch modes, open `tm`, `ti`, `t1`, `t1cg` and garbled links, then check the PDF boxes in Acrobat.

**8b. Size controls and end-stops.**
- **Size select:** `#shopSize` replaces `#paper` (`index.html:88-91`) in shop mode, filled like the paper select (`main.ts:707-722`), with the two groups sorted by area. Choosing Custom shows two number inputs, a unit select and an inline error.
- **Sheets stepper:** `#pagesGroup` (`105-120`) is hidden; its readout shows "Trim W × H | chart w × h".
- **Square slider:** the existing snap (`1378-1388`) end-stops at the largest fitting square (up to 260 mm).
- **X/Y:** `setGridSize` (`371-373`) clamps to `maxGridForSquare`. This is a new rule that needs sign-off: X/Y end-stop at the size limit and never change the square or distance.
- **Size too small for the band:** when a fixed size is too small for the distance band's minimum square, show a hint like `pagesFewestHint`: "Too small for 4m+: choose a larger size or Fit to chart".
- **Shop distance presets:** `resolveShopDistancePlan()`. Proposed:

  | Band | Grid | Square | Fit trim (metric) | Fit trim (inch) |
  |---|---|---|---|---|
  | Close | 7×5 | 32 mm | 245×210 mm | 9.75×8.25 in |
  | Near | 5×3 | 100 mm | 550×380 mm | 21.75×15 in |
  | Far | 3×5 | 101 mm | 355×585 mm (fits A2 and 18×24) | 14×23 in |

*Verify:* `check:shop` asserts that every shop preset is 1 sheet with a square ≥ the band minimum (10, 33 and 101 mm), and that every grid has a valid square at Fit.

**8c. Print-file options, buttons, filename, guards.**
- **Options**, in `#advancedSettings`:
  - **Bleed** select with the fixed list (Page geometry): Standard (3 mm or ⅛ in), None (exact trim), 5 mm (Officeworks mounted), 10 mm (Officeworks corflute/PVC/ACM), ¼ in (6.35 mm), and the other unit's standard. The page size is shown beside it, e.g. "File 24.25 × 36.25 in = 24 × 36 trim + ⅛ in bleed".
  - **Crop marks** checkbox, off by default: "Crop marks (trade printers that trim)". It adds the marks, the slug and the 7 mm mark margin.
  - **Colour | Monochrome** segmented control, default Colour. Monochrome shows "Black & white file (greyscale only)".
  - Nothing is greyed out for the cap, which applies to the trim only.
- **Buttons:**
  - Hide `#btnPdf` (Print) in shop mode; `openPrintDialog` (`1152`) returns early.
  - `#btnSavePdf` becomes `btn-primary` with the label "Download print-ready PDF".
- **Filename** (`exportBasenamePrefix`, `1024-1032`): `skellychart-printshop-24x36in-12x9-50mm`, `-841x594mm-` or `-fit-625x505mm-`, then the bleed in its own unit (`-bleed3mm`, `-bleed0.125in`, `-bleed5mm`, `-bleed10mm`, `-bleed0.25in`) or `-trim` for no bleed, then `-crop` with crop marks and `-mono` for monochrome. Example: `skellychart-printshop-24x36in-12x9-50mm-bleed0.125in-crop-mono`.
- **Release guard:** block shop export when the version is `develop` or a prerelease, or when the QR target is not `https://skelly.cam/c/` (`qrLinkTarget.ts`). In dev builds, a confirm() allows "Export anyway (test only)".

*Verify manually:*
- the filenames;
- the default (standard bleed, no marks) gives MediaBox = BleedBox;
- no bleed and no marks gives MediaBox = TrimBox = BleedBox;
- crop marks give MediaBox = BleedBox + 2 × 7 mm;
- each option (size, unit, bleed, marks, colour) round-trips through the link;
- Print is absent in shop mode.

**9. Scan-landing card.** Add `<section id="scanCard" class="banner scan-card hidden">` after `#qrVersionBanner` (`index.html:77`).
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

**10. Order-details note and advice copy.**
- In shop mode, the Print & Save panel shows a read-only block and a "Copy order details" button (`navigator.clipboard`, with a select-all fallback). The text, `S.shopOrder*`:
  - Print at 100% / actual size, no scaling, fit or fill.
  - Page size: "File is W′ × H′ = W × H trim + b bleed. Match the product template's page size exactly; never use a fit/fill option", or "No bleed; final size W × H".
  - With crop marks: "Trim to W × H at the crop marks (b bleed included)."
  - Board: matte, no lamination. 5 mm (3/16 in) foam board up to A1 / 24×36; 10 mm honeycomb or 3 mm ACM for A0 / 36×48. Coroplast is acceptable, not ideal.
  - Colour: "Black is pure K; print as supplied and do not convert colours." Mono: "Black & white file (greyscale only)."
  - Check on delivery: measure N squares edge to same edge; each should be s mm.
  - The 36 in cap note, when the chart is within 25 mm of the cap.
- The slug, the PDF Subject and the note must carry the same facts: 100%, trim and square size. The slug is trimmed off, and it exists only with crop marks.
- **Advice copy** (`S.printAdviceShop`, `strings.ts:65-67`, now points to the new mode; shop mode shows shop copy via `setPrintAdviceElement`, `477-489`): the Rigid-board advice above (finish, substrate, which product at each chain and its lead time, match the template), plus, with no marks: "If your shop trims by hand to crop marks, turn on Crop marks."

*Verify:* copy works in Chrome and Firefox, and the text follows size, bleed, marks and colour changes.

**11. Version, docs, wiring.**
- No version bump (v2 is unpublished). Run `check:banner` to confirm the home banner rows did not change.
- `.claude/skills/update-banner-size/SKILL.md`: shop banners are sized at runtime, and glyphs must be regenerated (`generate:glyphs`) when the font, the glyph set or `helveticaMetrics.ts` change.
- Add a README section.
- `build` runs `check:links`, `check:shop`, `check:glyphs` and `check:home-golden`.
- Ask the user to approve shop exceptions in the "Control priority rules" and "Multi-sheet print layout" memory notes: always 1 sheet, no guide, and X/Y end-stop at the size limit.

## Phase 2

**CMYK, with cyan added to the large black areas.** Shop colour mode only; monochrome stays DeviceGray, and home stays DeviceGray/RGB. (The logo flatten and the grey setter wrapper moved to phase 1, steps 0b and 7.)
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
  - Fetch it lazily from `public/icc/`, only for colour shop export.
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
- **Mark the rich black.** Only shop SVG gives the squares and markers a sentinel `fill="rgb(0,0,1)"`, in both places: each marker path (`src/charuco/board.ts:277`) and the board `<g>` (`board.ts:300`). Without the wrapper, the sentinel would write `0 0 0.004 rg`, so it must never appear in home or phase-1 output. In mono it maps to `0 g`.
- **Extend the phase-1 setter wrapper** (step 7) with a CMYK map for colour mode. Every svg2pdf colour call goes through the wrapped setters: `1770`, `1777`, `1808`, `1854-1889`, and the initial fill at `4132`.
  - Map the rounded `r,g,b` key to four 0..1 channels, which takes jsPDF's CMYK branch (`2317-2331`).
  - Keys: `0,0,1` → `[.6,0,0,1]`, `0,0,0` → `[0,0,0,1]`, `255,255,255` → `[0,0,0,0]`, plus the arrow and logo keys.
  - Throw on any key that is not in the map.
- **Defaults.** Construct the colour document with `strokeColor: '0 0 0 1 K'` and `fillColor: '0 0 0 1 k'`. Otherwise jsPDF writes `0 G` at the start of each page (`5113`, `5179`).
- **Paths that bypass the setters** must stay out of shop SVG: gradients (svg2pdf `1263`, DeviceRGB hard-coded at jsPDF `2651`), patterns (`1425-1447`), images (`3124`) and opacity below 1 or `<use>` (ExtGState, `1714-1762`).
- **Check.** For colour mode, `check:shop-pdf` asserts no `rg`/`RG`/`g`/`G` colour operators, no `/Shading`, `/Pattern` or `/Subtype /Image`, and no ExtGState. Mono keeps the phase-1 DeviceGray assertions.
- **Order note and slug** add, in colour mode: "Squares are C60 K100; text, QR and marks are K100 only; print CMYK as supplied; do not convert K100 to rich black."

**Deferred**
- Two-axis (X and Y) write-in boxes.
- Sizes beyond the 36 in walk-in cap, for sign shops: a 4×8 ft sheet (48×96 in, for plywood, drywall or ACM). The earlier analysis showed that 48×96 lifts the largest grid at 101 mm from 8×11 to 11×23. Add it as a new size code with its own end-stops, a sign-shop warning and order-note copy about flatness, weight and freight.
- A larger QR on big shop boards. The banner is computed at runtime, but the QR must not go below 22 mm.
- A "K-only blacks" option, and more sizes (B0 once the cap is raised, 22×28).
- A larger ArUco dictionary to lift the 250-marker limit; FreeMoCap's detector must use the same dictionary.
- Moving home mode to outlined text (handling `·` and the guide ring labels; a separate major decision).

## Risks and open questions

**Risks**
- Starting on `700d028` instead of the rebased branch means redoing nearly every touched file.
- New rule: X/Y end-stop in shop mode. "No page cap" and "counts include guide" do not apply there. This needs sign-off and memory-note updates.
- Standard size codes become permanent with the first printed board. Freeze the list and its order before release, and only append.
- Forgetting `putOnlyUsedFonts: true` on the shop path silently adds 14 fonts. `check:shop-pdf` catches it, but only when it is run.
- The OFL notice must survive minification; ship the licence file regardless.
- A `VITE_APP_VERSION` containing a character missing from the glyph table makes `outlineText` throw. `check:shop` covers the override.
- A Fit link reproduces the rounding rule, not a stored trim. A future layout change can alter a reopened Fit trim slightly; the board stays exact.
- Online designers may fit or fill the file to their template and scale the board. The order note's "match the template page size" line and the measure-N-squares check are the defence.
- The cheapest good direct-print foam board (Staples, Office Depot) is delivery only; same-day walk-in options are the FedEx and Office Depot mounted products, and some force gloss lamination.
- Phase-1 colour output carries RGB arrows and logo, which each RIP converts its own way. They sit in the margin, so only their hue is at stake.
- Phase 2 relies on jsPDF 4.2.1 and svg2pdf 2.8.1 internals. Pin both versions and keep the checks.

**Open questions**
1. Shop distance presets: is far 3×5 at 101 mm (Fit 355×585, about A2) right, or should the far square be larger, with a larger trim and price?
2. Should `check:home-golden` and its JSON stay committed for good? Recommended: yes.
3. Sign-off: in shop mode, X/Y end-stop at the selected size, the 36 in trim cap and the 250-marker limit.
4. Quiet zone: keep E = max(10, s/4), or cap it at 25 mm (which would raise 3×3 to about 280-286 mm)? This needs a calibration-accuracy call.
5. Default size: Fit to chart produces sizes rigid products don't sell (they come in fixed sizes). Should the default be the smallest stocked standard size that fits, with Fit kept for custom sign shops?
6. Is the mono toggle still wanted, given no rigid cost saving?

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
