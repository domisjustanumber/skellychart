/**
 * Print-shop size catalogue: the fixed sizes walk-in chains sell rigid boards in (the only trims shop mode
 * offers), the 36 in walk-in trim cap, the bleed choices and the page size they give. Pure: no DOM.
 *
 * Shop sizes are never added to `PAPER_OPTIONS`: the banner generator iterates over those papers, and
 * `originBannerReserveMm()` throws on any width it does not know.
 */
import {
    SHOP_SIZE_LINK_CODES,
    shopSizeNativeUnit,
    shopStandardBleedMm,
    type ShopPrintOptions,
    type ShopSizeId,
    type ShopUnit,
} from './charucoDocUrl.js';

export interface ShopSize {
    id: ShopSizeId;
    /** Link code (index in {@link SHOP_SIZE_LINK_CODES}). */
    code: number;
    /** Name as shops list it, e.g. `A1`, `24 × 36 in`, `450 × 600 mm`. */
    name: string;
    /** Extra name some shops use, e.g. `ARCH D`. */
    alias?: string;
    /** Short side × long side, mm. */
    wMm: number;
    hMm: number;
    /** The unit the size is sold in; the dropdown groups by it. */
    unit: ShopUnit;
}

const IN = 25.4;

const SIZE_SPECS: Record<ShopSizeId, Omit<ShopSize, 'id' | 'code' | 'unit'>> = {
    '12x18in': {name: '12 × 18 in', alias: 'ARCH B', wMm: 12 * IN, hMm: 18 * IN},
    '16x20in': {name: '16 × 20 in', wMm: 16 * IN, hMm: 20 * IN},
    '18x24in': {name: '18 × 24 in', alias: 'ARCH C', wMm: 18 * IN, hMm: 24 * IN},
    '24x36in': {name: '24 × 36 in', alias: 'ARCH D', wMm: 24 * IN, hMm: 36 * IN},
    '36x48in': {name: '36 × 48 in', alias: 'ARCH E', wMm: 36 * IN, hMm: 48 * IN},
    a3: {name: 'A3', wMm: 297, hMm: 420},
    a2: {name: 'A2', wMm: 420, hMm: 594},
    '450x600mm': {name: '450 × 600 mm', wMm: 450, hMm: 600},
    a1: {name: 'A1', wMm: 594, hMm: 841},
    '600x900mm': {name: '600 × 900 mm', wMm: 600, hMm: 900},
    b1: {name: 'B1', wMm: 707, hMm: 1000},
    a0: {name: 'A0', wMm: 841, hMm: 1189},
    '900x1200mm': {name: '900 × 1200 mm', wMm: 900, hMm: 1200},
};

/** Every standard size, by link code. */
export const SHOP_SIZES: readonly ShopSize[] = SHOP_SIZE_LINK_CODES.map((id, code) => ({
    id,
    code,
    unit: shopSizeNativeUnit(id),
    ...SIZE_SPECS[id],
}));

export function shopSizeById(id: ShopSizeId): ShopSize {
    return SHOP_SIZES.find((s) => s.id === id)!;
}

/** Dropdown groups: the toggled unit's sizes first, then the other unit's, each sorted by area. */
export function shopSizeGroups(unit: ShopUnit): {unit: ShopUnit; sizes: ShopSize[]}[] {
    const group = (u: ShopUnit) => ({
        unit: u,
        sizes: SHOP_SIZES.filter((s) => s.unit === u).sort((a, b) => a.wMm * a.hMm - b.wMm * b.hMm),
    });
    return unit === 'in' ? [group('in'), group('mm')] : [group('mm'), group('in')];
}

/**
 * The 36 in walk-in cap, on the trim (short side, long side), mm: the largest rigid board most walk-in
 * shops print, and the largest standard size (36 × 48 in). Bleed and crop marks may extend the page beyond it.
 */
export const SHOP_TRIM_MAX_MM: readonly [number, number] = [36 * IN, 48 * IN];

/**
 * Largest square length in shop mode (home mode stops at `CHARUCO_SQUARE_MM_MAX`): the largest square any
 * grid at least 3 wide fits on a standard size (3 × 3 on 36 × 48 in). 2-wide grids could go larger, but
 * their 1-2 inner corners are no use for calibration.
 */
export const SHOP_SQUARE_MM_MAX = 288;

/** Space outside the bleed for crop marks and the slug, mm. */
export const SHOP_CROP_MARK_MARGIN_MM = 7;

/** Crop marks run from the bleed edge outward this far, mm. */
export const SHOP_CROP_MARK_LENGTH_MM = 6;

/** US, Canadian and Puerto Rican shops sell rigid boards in inches; everywhere else defaults to metric. */
export const SHOP_INCH_REGIONS: ReadonlySet<string> = new Set(['US', 'CA', 'PR']);

export function shopUnitForRegion(region: string | undefined): ShopUnit {
    return region && SHOP_INCH_REGIONS.has(region.trim().toUpperCase()) ? 'in' : 'mm';
}

/** Whether a trim fits the walk-in cap in either orientation. */
export function fitsShopTrimCap(wMm: number, hMm: number): boolean {
    const [shortMax, longMax] = SHOP_TRIM_MAX_MM;
    return Math.min(wMm, hMm) <= shortMax + 1e-9 && Math.max(wMm, hMm) <= longMax + 1e-9;
}

/** The bleed select, in order: Standard, None, 5 mm, 10 mm, ¼ in, and the other unit's standard. */
export function shopBleedChoices(unit: ShopUnit): ShopPrintOptions['bleed'][] {
    return ['std', {mm: 0}, {mm: 5}, {mm: 10}, {mm: IN / 4}, {mm: shopStandardBleedMm(unit === 'in' ? 'mm' : 'in')}];
}

/** Bleed in mm: `'std'` follows the unit (3 mm or ⅛ in). */
export function bleedMmForUnit(bleed: ShopPrintOptions['bleed'], unit: ShopUnit): number {
    return bleed === 'std' ? shopStandardBleedMm(unit) : bleed.mm;
}

/** Margin from the trim to the page edge: the bleed, plus room for the crop marks and slug when on. */
export function shopMediaMarginMm(bleedMm: number, cropMarks: boolean): number {
    return bleedMm + (cropMarks ? SHOP_CROP_MARK_MARGIN_MM : 0);
}

/** PDF page (MediaBox) for a trim: trim + 2M. */
export function pageSizeMm(trim: {wMm: number; hMm: number}, bleedMm: number, cropMarks: boolean): {wMm: number; hMm: number} {
    const m = shopMediaMarginMm(bleedMm, cropMarks);
    return {wMm: trim.wMm + 2 * m, hMm: trim.hMm + 2 * m};
}

/** A length in the unit: mm to two decimals, inches to two decimals (¼ in steps print exactly). */
export function formatShopLength(mm: number, unit: ShopUnit): string {
    return String(Number((unit === 'in' ? mm / IN : mm).toFixed(2)));
}

/** `24 × 36 in`, `594 × 841 mm`. */
export function formatShopDims(wMm: number, hMm: number, unit: ShopUnit): string {
    return `${formatShopLength(wMm, unit)} × ${formatShopLength(hMm, unit)} ${unit}`;
}

/** Trim in the toggled unit, then the other: `24.75 × 20 in (628.65 × 508 mm)` (slug, PDF subject, note). */
export function formatShopTrim(wMm: number, hMm: number, unit: ShopUnit): string {
    return `${formatShopDims(wMm, hMm, unit)} (${formatShopDims(wMm, hMm, unit === 'in' ? 'mm' : 'in')})`;
}

/** Size dropdown entry: the shop's name, then its dimensions in the toggled unit when the name lacks them. */
export function shopSizeOptionLabel(size: ShopSize, unit: ShopUnit): string {
    const named = size.unit === unit && size.name.endsWith(` ${unit}`);
    const detail = [named ? null : formatShopDims(size.wMm, size.hMm, unit), size.alias].filter(Boolean).join(', ');
    return detail ? `${size.name} (${detail})` : size.name;
}

/** Bleed in its own unit: `⅛ in`, `¼ in`, `3 mm`, `10 mm`; 0 is no bleed. */
export function formatShopBleed(bleedMm: number): string {
    const eighths = (bleedMm / IN) * 8;
    if (bleedMm > 0 && Math.abs(eighths - Math.round(eighths)) < 1e-9 && Math.round(eighths) <= 2) {
        return Math.round(eighths) === 1 ? '⅛ in' : '¼ in';
    }
    return `${formatShopLength(bleedMm, 'mm')} mm`;
}
