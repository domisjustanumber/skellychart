/**
 * Build guard for print-shop mode: the size catalogue and its frozen link codes, Fit-to-chart rounding,
 * the 36 in walk-in trim cap, the bleed choices and page sizes, and the custom-size limits.
 */
import {SHOP_SIZE_LINK_CODES, shopStandardBleedMm} from '../src/print/charucoDocUrl.js';
import {
    SHOP_CROP_MARK_MARGIN_MM,
    SHOP_SIZES,
    SHOP_TRIM_MAX_MM,
    bleedMmForUnit,
    fitsShopTrimCap,
    formatShopBleed,
    formatShopTrim,
    pageSizeMm,
    roundUpTrimMm,
    roundUpTrimSteps,
    shopBleedChoices,
    shopFitCapMm,
    shopSizeGroups,
    shopSizeOptionLabel,
    shopTrimStepMm,
    shopUnitForRegion,
    validateCustomTrim,
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

// Fit rounding: an exact multiple of the step, at least the input and less than one step more.
for (const unit of UNITS) {
    const step = shopTrimStepMm(unit);
    for (let i = 0; i <= 26000; i++) {
        const x = 50 + i * 0.0473;
        const r = roundUpTrimMm(x, unit);
        const steps = roundUpTrimSteps(x, unit);
        if (!near(r, steps * step) || r < x - 1e-9 || r >= x + step - 1e-9) {
            failures.push(`${unit}: ${x} mm rounds to ${r} mm`);
            break;
        }
    }
    for (let n = 10; n <= 250; n++) {
        if (roundUpTrimSteps(n * step, unit) !== n) {
            failures.push(`${unit}: exact ${n} steps (${n * step} mm) rounds to ${roundUpTrimSteps(n * step, unit)} steps`);
        }
    }
}
if (roundUpTrimMm(625, 'mm') !== 625 || roundUpTrimMm(503.5, 'mm') !== 505 || !near(roundUpTrimMm(625, 'in'), 628.65) || !near(roundUpTrimMm(503.5, 'in'), 508)) {
    failures.push('worked example (12 × 9 at 50 mm) does not round to 625 × 505 mm and 24.75 × 20 in');
}

// The walk-in cap holds for every standard size and both Fit caps.
const [shortMax, longMax] = SHOP_TRIM_MAX_MM;
for (const s of SHOP_SIZES) {
    if (!fitsShopTrimCap(s.wMm, s.hMm) || Math.min(s.wMm, s.hMm) > shortMax || Math.max(s.wMm, s.hMm) > longMax) {
        failures.push(`${s.id} exceeds the walk-in cap`);
    }
}
const metricCap = shopFitCapMm('mm');
const inchCap = shopFitCapMm('in');
if (!near(metricCap[0], 910) || !near(metricCap[1], 1215) || !near(inchCap[0], 914.4) || !near(inchCap[1], 1219.2)) {
    failures.push(`Fit caps are ${metricCap} mm and ${inchCap} mm, expected 910 × 1215 and 914.4 × 1219.2`);
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

// Custom trims: whole mm or ¼ in, at least the content, within the cap.
const custom: [number, number, 'mm' | 'in', number, number, string][] = [
    [841, 594, 'mm', 625, 503.5, 'ok'],
    [624, 594, 'mm', 625, 503.5, 'min'],
    [841, 503, 'mm', 625, 503.5, 'min'],
    [841.5, 594, 'mm', 625, 503.5, 'step'],
    [914, 1219, 'mm', 100, 70, 'ok'],
    [915, 1219, 'mm', 100, 70, 'max'],
    [1219, 914, 'mm', 100, 70, 'ok'],
    [1220, 914, 'mm', 100, 70, 'max'],
    [24.5, 36, 'in', 475, 653.5, 'ok'],
    [24.25, 36, 'in', 615.95, 653.5, 'ok'],
    [24.25, 36, 'in', 622.3, 653.5, 'min'],
    [24.1, 36, 'in', 475, 653.5, 'step'],
    [36, 48, 'in', 100, 70, 'ok'],
    [36.25, 48, 'in', 100, 70, 'max'],
    [0, 48, 'in', 0, 0, 'step'],
];
for (const [w, h, unit, minW, minH, wanted] of custom) {
    const r = validateCustomTrim(w, h, unit, minW, minH);
    const got = r.ok ? 'ok' : r.error;
    if (got !== wanted) {
        failures.push(`custom ${w} × ${h} ${unit} (needs ${minW} × ${minH} mm): ${got}, expected ${wanted}`);
    }
}

for (const [region, unit] of [['US', 'in'], ['CA', 'in'], ['PR', 'in'], ['us', 'in'], ['MX', 'mm'], ['PH', 'mm'], ['GB', 'mm'], ['AU', 'mm'], [undefined, 'mm']] as const) {
    if (shopUnitForRegion(region) !== unit) {
        failures.push(`region ${region} defaults to ${shopUnitForRegion(region)}, expected ${unit}`);
    }
}

if (failures.length > 0) {
    console.error(`\nShop check failed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
}
console.log(`check:shop: ${SHOP_SIZES.length} sizes, rounding, cap, bleeds and custom limits OK`);
