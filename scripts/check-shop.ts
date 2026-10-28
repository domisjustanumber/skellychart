/**
 * Build guard for print-shop mode: the size catalogue and its frozen link codes, the 36 in walk-in trim
 * cap, the bleed choices and page sizes, outlined text, the compact banner and the board geometry.
 */
import fs from 'node:fs';
import {displayAppVersion} from '../src/appVersion.js';
import {SHOP_SIZE_LINK_CODES, shopStandardBleedMm} from '../src/print/charucoDocUrl.js';
import {GLYPH_CAP_HEIGHT_EM, GLYPH_OUTLINES, GLYPH_X_HEIGHT_EM} from '../src/print/glyphOutlines.generated.js';
import {helveticaTextWidthPx} from '../src/print/helveticaMetrics.js';
import {canOutlineText, outlineText} from '../src/print/outlineText.js';
import {BOARD_GRID_MAX, BOARD_GRID_MIN, boardGridAxisMax} from '../src/print/charucoLayout.js';
import {
    CHARUCO_SQUARE_MM_MIN,
    MM_ORIGIN_BANNER_BELOW_GAP_MM,
    ORIGIN_BANNER_VISUAL_SCALE,
    PIXELS_PER_MM,
    SKELLY_TOP_HEIGHT_MM,
} from '../src/print/constants.js';
import {
    SHOP_MARKER_ROOM_MM,
    maxShopGridForSquare,
    maxShopSquareMm,
    shopQuietZoneMm,
    shopSheetLayout,
    shopValidSquaresMm,
    smallestFittingShopSize,
} from '../src/print/shopLayout.js';
import {
    bannerLogoSizePx,
    compactBannerHeightMm,
    compactBannerMinWidthPx,
    layoutOriginBanner,
} from '../src/print/originBannerLayout.js';
import {SKELLY_LOGO_NATURAL_W_OVER_H} from '../src/print/skellyLogo.js';
import {
    SHOP_CROP_MARK_MARGIN_MM,
    SHOP_SIZES,
    SHOP_SQUARE_MM_MAX,
    SHOP_TRIM_MAX_MM,
    bleedMmForUnit,
    fitsShopTrimCap,
    formatShopBleed,
    formatShopTrim,
    pageSizeMm,
    shopBleedChoices,
    shopSizeGroups,
    shopSizeOptionLabel,
    shopUnitForRegion,
} from '../src/print/shopSizes.js';

const failures: string[] = [];
const UNITS = ['mm', 'in'] as const;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

// Frozen link codes: never renumbered once v2 is published.
const FROZEN: Record<number, [string, number, number]> = {
    0: ['18x24in', 457.2, 609.6],
    1: ['24x36in', 609.6, 914.4],
    2: ['36x48in', 914.4, 1219.2],
    3: ['a2', 420, 594],
    4: ['a1', 594, 841],
    5: ['a0', 841, 1189],
    6: ['12x18in', 304.8, 457.2],
    7: ['16x20in', 406.4, 508],
    8: ['a3', 297, 420],
    9: ['b1', 707, 1000],
    10: ['450x600mm', 450, 600],
    11: ['600x900mm', 600, 900],
    12: ['900x1200mm', 900, 1200],
};
if (SHOP_SIZE_LINK_CODES.length < Object.keys(FROZEN).length) {
    failures.push('a frozen shop size code was removed');
}
for (const [code, [id, w, h]] of Object.entries(FROZEN)) {
    const size = SHOP_SIZES[Number(code)];
    if (SHOP_SIZE_LINK_CODES[Number(code)] !== id || size?.id !== id || size.code !== Number(code) || !near(size.wMm, w) || !near(size.hMm, h)) {
        failures.push(`code ${code} must stay ${id} (${w} × ${h} mm), got ${JSON.stringify(size)}`);
    }
}

// Dropdown groups: toggled unit first, each sorted by area, every size listed once.
for (const unit of UNITS) {
    const groups = shopSizeGroups(unit);
    if (groups[0]!.unit !== unit || groups.flatMap((g) => g.sizes).length !== SHOP_SIZES.length) {
        failures.push(`${unit} toggle: groups ${groups.map((g) => g.unit).join(', ')} do not list every size, toggled unit first`);
    }
    for (const g of groups) {
        const areas = g.sizes.map((s) => s.wMm * s.hMm);
        if (areas.some((a, i) => i > 0 && a < areas[i - 1]!) || g.sizes.some((s) => s.unit !== g.unit)) {
            failures.push(`${unit} toggle: ${g.unit} group is not sorted by area`);
        }
        for (const s of g.sizes) {
            const label = shopSizeOptionLabel(s, unit);
            if (!label.startsWith(s.name) || (s.unit !== unit && !label.includes(` ${unit}`))) {
                failures.push(`${unit} toggle: label "${label}" for ${s.id} lacks its name or toggled-unit size`);
            }
        }
    }
}

// The walk-in cap holds for every standard size.
const [shortMax, longMax] = SHOP_TRIM_MAX_MM;
for (const s of SHOP_SIZES) {
    if (!fitsShopTrimCap(s.wMm, s.hMm) || Math.min(s.wMm, s.hMm) > shortMax || Math.max(s.wMm, s.hMm) > longMax) {
        failures.push(`${s.id} exceeds the walk-in cap`);
    }
}
if (fitsShopTrimCap(915, 915) || fitsShopTrimCap(900, 1220) || !fitsShopTrimCap(1219.2, 914.4) || !fitsShopTrimCap(915, 900)) {
    failures.push('fitsShopTrimCap does not apply the cap to short and long sides in either orientation');
}

// Page = trim + 2b with no marks, trim + 2(b + 7) with crop marks, for every bleed in the select.
for (const unit of UNITS) {
    const choices = shopBleedChoices(unit);
    if (choices.length !== 6 || choices[0] !== 'std' || bleedMmForUnit(choices[1]!, unit) !== 0) {
        failures.push(`${unit}: bleed select is not Standard, None, 5, 10, ¼ in, other standard`);
    }
    const other = bleedMmForUnit(choices[5]!, unit);
    if (!near(other, shopStandardBleedMm(unit === 'in' ? 'mm' : 'in'))) {
        failures.push(`${unit}: last bleed is ${other} mm, not the other unit's standard`);
    }
    for (const s of SHOP_SIZES) {
        for (const bleed of choices) {
            const b = bleedMmForUnit(bleed, unit);
            const plain = pageSizeMm(s, b, false);
            const marked = pageSizeMm(s, b, true);
            if (!near(plain.wMm, s.wMm + 2 * b) || !near(plain.hMm, s.hMm + 2 * b)) {
                failures.push(`${s.id} ${unit} bleed ${b}: page ${plain.wMm} × ${plain.hMm}`);
            }
            if (!near(marked.wMm, s.wMm + 2 * (b + SHOP_CROP_MARK_MARGIN_MM)) || !near(marked.hMm, s.hMm + 2 * (b + SHOP_CROP_MARK_MARGIN_MM))) {
                failures.push(`${s.id} ${unit} bleed ${b} + crop marks: page ${marked.wMm} × ${marked.hMm}`);
            }
        }
    }
}
for (const [mm, label] of [[3.175, '⅛ in'], [6.35, '¼ in'], [3, '3 mm'], [5, '5 mm'], [10, '10 mm']] as const) {
    if (formatShopBleed(mm) !== label) {
        failures.push(`bleed ${mm} mm is labelled "${formatShopBleed(mm)}", expected "${label}"`);
    }
}
if (formatShopTrim(628.65, 508, 'in') !== '24.75 × 20 in (628.65 × 508 mm)') {
    failures.push(`trim label is "${formatShopTrim(628.65, 508, 'in')}"`);
}

for (const [region, unit] of [['US', 'in'], ['CA', 'in'], ['PR', 'in'], ['us', 'in'], ['MX', 'mm'], ['PH', 'mm'], ['GB', 'mm'], ['AU', 'mm'], [undefined, 'mm']] as const) {
    if (shopUnitForRegion(region) !== unit) {
        failures.push(`region ${region} defaults to ${shopUnitForRegion(region)}, expected ${unit}`);
    }
}

// Outlined text: no fonts, glyphs placed with the AFM advances, and every printable version outlines.
const OUTLINE_SAMPLES = [
    'PRINT AT 100% - DO NOT SCALE | Trim 24.75 × 20 in (628.65 × 508 mm) | 12 × 9 squares | 50 mm | v2.0.0',
    'FreeMoCap calibration chart – 7 × 5 squares, 32 mm “square” — 0.8 marker’s °',
];
/** Horizontal extent of an outlined path in its own 1000-unit frame. */
function pathXExtent(svg: string): [number, number] {
    const d = /\sd="([^"]*)"/.exec(svg)?.[1] ?? '';
    const xs: number[] = [];
    let isX = true;
    for (const token of d.match(/[MLQZ]|-?\d+(?:\.\d+)?/g) ?? []) {
        if (/[MLQZ]/.test(token)) {
            isX = true;
        } else {
            if (isX) {
                xs.push(Number(token));
            }
            isX = !isX;
        }
    }
    return [Math.min(...xs), Math.max(...xs)];
}
for (const bold of [false, true]) {
    for (const sample of OUTLINE_SAMPLES) {
        const svg = outlineText(sample, {x: 10, y: 20, fontPx: 25.4, bold});
        if (/<text|<tspan|font-family|<use|<defs/.test(svg) || !svg.startsWith('<path ')) {
            failures.push(`outlineText("${sample}") is not a single font-free <path>`);
        }
    }
    // H c H is wider than H H by exactly c's AFM advance, so each glyph is placed at the measured pen position.
    const [hhMin, hhMax] = pathXExtent(outlineText('HH', {x: 0, y: 0, fontPx: 1000, bold}));
    for (const ch of Object.keys(GLYPH_OUTLINES.normal)) {
        const [min, max] = pathXExtent(outlineText(`H${ch}H`, {x: 0, y: 0, fontPx: 1000, bold}));
        const gained = max - min - (hhMax - hhMin);
        if (Math.abs(gained - helveticaTextWidthPx(ch, 1000, bold)) > 1e-9) {
            failures.push(`outline of U+${ch.codePointAt(0)!.toString(16)} (${bold ? 'bold' : 'normal'}) advances ${gained}, not its AFM width`);
        }
    }
}
{
    const fontPx = 30;
    const width = helveticaTextWidthPx('Trim', fontPx);
    const tx = (svg: string) => Number(/matrix\(\S+ 0 0 \S+ (\S+) (\S+)\)/.exec(svg)?.[1]);
    const ty = (svg: string) => Number(/matrix\(\S+ 0 0 \S+ (\S+) (\S+)\)/.exec(svg)?.[2]);
    const at = (anchor: 'start' | 'middle' | 'end', baseline: 'alphabetic' | 'hanging' | 'middle') =>
        outlineText('Trim', {x: 100, y: 50, fontPx, anchor, baseline});
    if (!near(tx(at('start', 'alphabetic')), 100) || !near(tx(at('middle', 'alphabetic')), 100 - width / 2) || !near(tx(at('end', 'alphabetic')), 100 - width)) {
        failures.push('outlineText anchors do not follow the AFM width');
    }
    if (!near(ty(at('start', 'alphabetic')), 50) || !near(ty(at('start', 'hanging')), 50 + GLYPH_CAP_HEIGHT_EM * fontPx) || !near(ty(at('start', 'middle')), 50 + (GLYPH_X_HEIGHT_EM / 2) * fontPx)) {
        failures.push('outlineText baselines are not at the cap height / half x-height');
    }
    let threw = false;
    try {
        outlineText('a·b', {x: 0, y: 0, fontPx});
    } catch {
        threw = true;
    }
    if (!threw) {
        failures.push('outlineText does not throw on a character with no outline (U+00B7)');
    }
}
const pkgVersion: string = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
for (const version of ['develop', pkgVersion, process.env.VITE_APP_VERSION?.trim()].filter((v): v is string => Boolean(v))) {
    for (const printed of [version, displayAppVersion(version)]) {
        if (!canOutlineText(`v${printed}`) || !canOutlineText(`v${printed}`, true)) {
            failures.push(`version "${printed}" has characters with no outline`);
        }
    }
}

// Compact banner: one height for every square length, grid and version (the QR sets it), and narrow.
const VERSIONS = [
    ...new Set(
        ['develop', pkgVersion, process.env.VITE_APP_VERSION?.trim()]
            .filter((v): v is string => Boolean(v))
            .map(displayAppVersion),
    ),
];
/** One value per distinct printed width: the banner depends on numbers only through their Helvetica widths. */
function widthRepresentatives(min: number, max: number): number[] {
    const byWidth = new Map<number, number>();
    for (let v = max; v >= min; v--) {
        byWidth.set(helveticaTextWidthPx(String(v), 1000), v);
    }
    return [...byWidth.values()];
}
const logo = bannerLogoSizePx(SKELLY_TOP_HEIGHT_MM, SKELLY_LOGO_NATURAL_W_OVER_H);
const bannerHeights = new Set<number>();
let widestBannerPx = 0;
let bannerLayouts = 0;
const gridCounts = widthRepresentatives(BOARD_GRID_MIN, BOARD_GRID_MAX);
for (const version of VERSIONS) {
    for (const squareLengthMm of widthRepresentatives(CHARUCO_SQUARE_MM_MIN, SHOP_SQUARE_MM_MAX)) {
        for (const squaresX of gridCounts) {
            for (const squaresY of gridCounts.filter((y) => y <= boardGridAxisMax(squaresX))) {
                const params = {
                    typeScale: ORIGIN_BANNER_VISUAL_SCALE,
                    version,
                    squareLengthMm,
                    squaresX,
                    squaresY,
                    logoWidthPx: logo.widthPx,
                    logoHeightPx: logo.heightPx,
                    capHeightEm: GLYPH_CAP_HEIGHT_EM,
                };
                bannerHeights.add(Math.round(compactBannerHeightMm(params) * 1e6) / 1e6);
                widestBannerPx = Math.max(widestBannerPx, compactBannerMinWidthPx(params));
                bannerLayouts++;
            }
        }
    }
}
if (bannerHeights.size !== 1 || ![...bannerHeights].every((h) => near(h, 28.5))) {
    failures.push(`compact banner heights are ${[...bannerHeights].join(', ')} mm, expected 28.5 mm for every chart`);
}
if (widestBannerPx / PIXELS_PER_MM > 110) {
    failures.push(`compact banner needs ${(widestBannerPx / PIXELS_PER_MM).toFixed(1)} mm, more than 110 mm`);
}
{
    // At its minimum width the banner lays out; one px narrower a chart-info line would wrap.
    const params = {
        typeScale: ORIGIN_BANNER_VISUAL_SCALE,
        version: VERSIONS[0]!,
        squareLengthMm: 260,
        squaresX: 20,
        squaresY: 25,
        logoWidthPx: logo.widthPx,
        logoHeightPx: logo.heightPx,
    };
    const minPx = compactBannerMinWidthPx(params);
    const at = (w: number) =>
        layoutOriginBanner({...params, paperWMm: 0, paperHMm: 0, variant: 'compact', box: {leftPx: 100, rightPx: 100 + w, topPx: 50}});
    if (!at(minPx) || at(minPx - 1) || at(minPx)!.instLines.length !== 0) {
        failures.push(`compact banner minimum width ${minPx} px is not the narrowest box it fits`);
    }
}

// Shop geometry: content inside the trim with the quiet zone on every side, the marker inside it, and
// exact end-stops (the largest square fits, one more does not; valid squares contiguous from 10 mm).
if (MM_ORIGIN_BANNER_BELOW_GAP_MM < SHOP_MARKER_ROOM_MM.top) {
    failures.push(`the banner's gap below (${MM_ORIGIN_BANNER_BELOW_GAP_MM} mm) leaves no room for the corner marker above the board`);
}
const SAMPLE_COUNTS = [2, 3, 5, 7, 12, 20, 40];
let layoutChecks = 0;
for (const size of SHOP_SIZES) {
    for (const squaresX of SAMPLE_COUNTS) {
        for (const squaresY of SAMPLE_COUNTS.filter((y) => y <= boardGridAxisMax(squaresX))) {
            const label = `${size.id} ${squaresX}×${squaresY}`;
            const valid = shopValidSquaresMm(squaresX, squaresY, size.id);
            if (valid.length > 0 && (valid[0] !== CHARUCO_SQUARE_MM_MIN || valid.some((s, i) => i > 0 && s !== valid[i - 1]! + 1))) {
                failures.push(`${label}: valid squares are not contiguous from ${CHARUCO_SQUARE_MM_MIN} mm`);
            }
            const max = maxShopSquareMm(squaresX, squaresY, size.id);
            if (max !== null && max < SHOP_SQUARE_MM_MAX && shopSheetLayout(squaresX, squaresY, max + 1, size.id)) {
                failures.push(`${label}: ${max + 1} mm also fits, so ${max} mm is not the largest square`);
            }
            for (const s of valid) {
                const l = shopSheetLayout(squaresX, squaresY, s, size.id)!;
                const e = shopQuietZoneMm(s);
                const {content: c, board: b, banner: n} = l;
                const tooClose = c.x < e - 1e-9 || c.y < e - 1e-9 || c.x + c.w > l.trimWMm - e + 1e-9 || c.y + c.h > l.trimHMm - e + 1e-9;
                const trimOk = near(Math.min(l.trimWMm, l.trimHMm), size.wMm) && near(Math.max(l.trimWMm, l.trimHMm), size.hMm);
                if (tooClose || !trimOk || b.x < SHOP_MARKER_ROOM_MM.left || !near(b.w, squaresX * s) || !near(b.h, squaresY * s) || !near(n.y + n.h, b.y) || b.x < c.x - 1e-9 || b.x + b.w > c.x + c.w + 1e-9) {
                    failures.push(`${label} at ${s} mm: content, board or banner outside the trim's quiet zone`);
                    break;
                }
                layoutChecks++;
            }
        }
    }
}
// The default size is the first in dropdown order (toggled unit's group first, by area) the board fits.
for (const unit of UNITS) {
    const order = shopSizeGroups(unit).flatMap((g) => g.sizes);
    for (const squaresX of SAMPLE_COUNTS) {
        for (const squaresY of SAMPLE_COUNTS.filter((y) => y <= boardGridAxisMax(squaresX))) {
            for (const squareMm of [10, 25, 33, 50, 101, 150, 225, 288]) {
                const chosen = smallestFittingShopSize(squaresX, squaresY, squareMm, unit);
                const first = order.find((s) => shopSheetLayout(squaresX, squaresY, squareMm, s.id));
                if (chosen !== (first?.id ?? null)) {
                    failures.push(`${unit} ${squaresX}×${squaresY} at ${squareMm} mm: default ${chosen}, expected ${first?.id ?? 'none'}`);
                }
            }
        }
    }
}
const shopSquareMax = Math.max(...SHOP_SIZES.map((s) => maxShopSquareMm(3, 3, s.id) ?? 0));
if (shopSquareMax !== SHOP_SQUARE_MM_MAX) {
    failures.push(`the largest 3-wide square on any size is ${shopSquareMax} mm, but SHOP_SQUARE_MM_MAX is ${SHOP_SQUARE_MM_MAX}`);
}
// What the 36 × 48 in cap allows (valid boards only, X·Y ≤ 501).
for (const [squareMm, area, limit] of [[101, 88, '8×11'], [50, 391, '17×23'], [45, 494, '26×19'], [44, 500, '20×25'], [22, 500, '20×25']] as const) {
    let best = 0;
    for (let x = BOARD_GRID_MIN; x <= BOARD_GRID_MAX; x++) {
        const y = maxShopGridForSquare('squaresY', x, squareMm, '36x48in');
        best = Math.max(best, y === null ? 0 : x * y);
    }
    if (best !== area) {
        failures.push(`at ${squareMm} mm the largest board on 36 × 48 in has ${best} squares, expected ${area} (${limit})`);
    }
}
{
    const l = shopSheetLayout(12, 9, 50, '24x36in');
    if (!l?.landscape || !near(l.quietZoneMm, 12.5) || smallestFittingShopSize(12, 9, 50, 'in') !== '24x36in' || smallestFittingShopSize(12, 9, 50, 'mm') !== 'a1') {
        failures.push('worked example: 12 × 9 at 50 mm is not 24 × 36 in landscape (inch toggle) or A1 (mm toggle)');
    }
    if (shopQuietZoneMm(20) !== 10 || shopQuietZoneMm(60) !== 15 || shopQuietZoneMm(200) !== 25) {
        failures.push('quiet zone is not min(25, max(10, s/4))');
    }
}

if (failures.length > 0) {
    console.error(`\nShop check failed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
}
console.log(
    `check:shop: ${SHOP_SIZES.length} sizes, cap, bleeds, outlined text OK; ${layoutChecks} layouts; ` +
        `compact banner ${[...bannerHeights][0]} mm high, at most ${(widestBannerPx / PIXELS_PER_MM).toFixed(1)} mm wide (${bannerLayouts} charts)`,
);
