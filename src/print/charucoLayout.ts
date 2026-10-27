/**
 * Print layout + preset rules matching freemocap `charucoPrintLayout.ts`
 * (tiling math is in `tiling.ts`; this module adds UI presets and snapping).
 */
import {buildPageSpecs, type TilingInfo} from './tiling.js';
import {CHARUCO_SQUARE_MM_MAX, CHARUCO_SQUARE_MM_MIN} from './constants.js';
import {gridFeasibility, printedLayout} from './feasibilityRules.js';
import {charucoBoardPixelLayout, charucoCropXRange, charucoCropYRange} from '../charuco/board.js';

export const PAPER_OPTIONS: {id: string; wMm: number; hMm: number}[] = [
    {id: 'a4', wMm: 210, hMm: 297},
    {id: 'a3', wMm: 297, hMm: 420},
    {id: 'letter', wMm: 215.9, hMm: 279.4},
    {id: 'tabloid', wMm: 279.4, hMm: 431.8},
];

const LETTER_DEFAULT_REGIONS = new Set([
    'US', 'CA', 'MX', 'PH', 'BZ', 'GT', 'SV', 'HN', 'NI', 'CR', 'PA', 'DO', 'PR', 'VI', 'CO', 'VE',
    'EC', 'CL',
]);

function regionFromLocaleTag(tag: string | undefined): string | undefined {
    if (!tag?.trim()) {
        return undefined;
    }
    try {
        const region = new Intl.Locale(tag).region;
        return region ? region.toUpperCase() : undefined;
    } catch {
        return undefined;
    }
}

const CANADA_TIMEZONES = new Set([
    'America/St_Johns', 'America/Halifax', 'America/Glace_Bay', 'America/Moncton', 'America/Goose_Bay',
    'America/Blanc-Sablon', 'America/Toronto', 'America/Nipigon', 'America/Thunder_Bay', 'America/Iqaluit',
    'America/Pangnirtung', 'America/Atikokan', 'America/Winnipeg', 'America/Regina', 'America/Swift_Current',
    'America/Edmonton', 'America/Cambridge_Bay', 'America/Yellowknife', 'America/Inuvik', 'America/Creston',
    'America/Dawson_Creek', 'America/Fort_Nelson', 'America/Vancouver', 'America/Whitehorse', 'America/Dawson',
    'America/Rankin_Inlet', 'America/Resolute', 'America/Rainy_River', 'Canada/Atlantic', 'Canada/Central',
    'Canada/Eastern', 'Canada/Mountain', 'Canada/Newfoundland', 'Canada/Pacific', 'Canada/Saskatchewan',
    'Canada/Yukon',
]);

/** Primary US IANA zones — default paper when time zone matches (see {@link defaultPaperId}). */
const US_PRIMARY_TIMEZONES = new Set([
    'America/New_York', 'America/Detroit', 'America/Kentucky/Louisville', 'America/Kentucky/Monticello',
    'America/Indiana/Indianapolis', 'America/Indiana/Vincennes', 'America/Indiana/Winamac', 'America/Indiana/Marengo',
    'America/Indiana/Petersburg', 'America/Indiana/Vevay', 'America/Indiana/Tell_City', 'America/Indiana/Knox',
    'America/Chicago', 'America/Menominee', 'America/North_Dakota/Center', 'America/North_Dakota/New_Salem',
    'America/North_Dakota/Beulah', 'America/Denver', 'America/Boise', 'America/Phoenix', 'America/Los_Angeles',
    'America/Anchorage', 'America/Juneau', 'America/Sitka', 'America/Metlakatla', 'America/Yakutat', 'America/Nome',
    'America/Adak', 'Pacific/Honolulu', 'Pacific/Guam', 'Pacific/Saipan', 'America/Puerto_Rico', 'America/St_Thomas',
]);

const MEXICO_PRIMARY_TIMEZONES = new Set([
    'America/Mexico_City', 'America/Cancun', 'America/Merida', 'America/Matamoros', 'America/Monterrey',
    'America/Mazatlan', 'America/Chihuahua', 'America/Hermosillo', 'America/Tijuana', 'America/Bahia_Banderas',
    'America/Ojinaga',
]);

function regionFromLetterDefaultTimeZone(): string | undefined {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (!tz) {
            return undefined;
        }
        if (CANADA_TIMEZONES.has(tz)) {
            return 'CA';
        }
        if (US_PRIMARY_TIMEZONES.has(tz)) {
            return 'US';
        }
        if (MEXICO_PRIMARY_TIMEZONES.has(tz)) {
            return 'MX';
        }
    } catch {
        /* ignore */
    }
    return undefined;
}

function workingDistanceLocaleTags(): string[] {
    const candidates: string[] = [];
    try {
        candidates.push(Intl.DateTimeFormat().resolvedOptions().locale);
    } catch {
        /* ignore */
    }
    if (typeof navigator !== 'undefined') {
        candidates.push(navigator.language);
        if (navigator.languages?.length) {
            candidates.push(...navigator.languages);
        }
    }
    return candidates;
}

function firstRegionFromLocaleTags(): string | undefined {
    for (const c of workingDistanceLocaleTags()) {
        const r = regionFromLocaleTag(c);
        if (r) {
            return r;
        }
    }
    return undefined;
}

export function defaultPaperIdForRegion(region: string | undefined): string {
    const r = region?.trim().toUpperCase();
    if (r && LETTER_DEFAULT_REGIONS.has(r)) {
        return 'letter';
    }
    return 'a4';
}

/**
 * Default paper: known IANA time zone → region (CA / US / MX allowlists), else first BCP-47 region from
 * locale / `navigator`, else A4.
 */
export function defaultPaperId(): string {
    const fromTz = regionFromLetterDefaultTimeZone();
    if (fromTz) {
        return defaultPaperIdForRegion(fromTz);
    }
    return defaultPaperIdForRegion(firstRegionFromLocaleTags());
}

/** Feet vs metres for working-distance copy: US English → ft; first other explicit region → m. */
export function shouldUseImperialWorkingDistanceUnits(): boolean {
    for (const c of workingDistanceLocaleTags()) {
        const r = regionFromLocaleTag(c);
        if (r === 'US') {
            return true;
        }
        if (r) {
            return false;
        }
    }
    return false;
}

export function paperById(id: string): (typeof PAPER_OPTIONS)[0] | undefined {
    return PAPER_OPTIONS.find((p) => p.id === id);
}

export type PaperFormatClass = 'small' | 'large';

export function paperFormatClass(paperId: string): PaperFormatClass {
    return paperId === 'a3' || paperId === 'tabloid' ? 'large' : 'small';
}

export function resolveDistancePrintPlan(
    distanceId: string,
    paperId: string,
): {squaresX: number; squaresY: number; targetPages: number} {
    const large = paperFormatClass(paperId) === 'large';
    /** `mid` and other legacy ids behave like `near` (2–4m tier). */
    const tier: WorkingDistanceTierId =
        distanceId === 'far' ? 'far' : distanceId === 'close' ? 'close' : 'near';
    if (!large) {
        if (tier === 'far') {
            return {squaresX: 3, squaresY: 5, targetPages: 9};
        }
        if (tier === 'close') {
            return {squaresX: 7, squaresY: 5, targetPages: 1};
        }
        return {squaresX: 5, squaresY: 3, targetPages: 1};
    }
    if (tier === 'far') {
        return {squaresX: 3, squaresY: 5, targetPages: 3};
    }
    if (tier === 'close') {
        return {squaresX: 7, squaresY: 5, targetPages: 1};
    }
    return {squaresX: 5, squaresY: 3, targetPages: 1};
}

export {CHARUCO_SQUARE_MM_MAX, CHARUCO_SQUARE_MM_MIN} from './constants.js';

/**
 * Square lengths up to this (mm) map to the `close` preset (UI: “1 - 2m”); between this and
 * {@link SQUARE_LENGTH_LT_4M_MAX_MM} map to `near` (“2 - 4m”); larger map to `far` (“4m +”).
 * Chosen so the largest valid square for a 7×5 tile on A4/Letter (28 mm) stays in the close band.
 */
export const SQUARE_LENGTH_LT_2M_MAX_MM = 32;

/** Upper bound (mm) for the `near` / “2 - 4m” band; above this is `far`. */
export const SQUARE_LENGTH_LT_4M_MAX_MM = 100;

export type WorkingDistanceTierId = 'close' | 'near' | 'far';

export function workingDistanceTierFromSquareLengthMm(squareMm: number): WorkingDistanceTierId {
    const m = Math.round(Math.max(CHARUCO_SQUARE_MM_MIN, Math.min(CHARUCO_SQUARE_MM_MAX, squareMm)));
    if (m <= SQUARE_LENGTH_LT_2M_MAX_MM) {
        return 'close';
    }
    if (m <= SQUARE_LENGTH_LT_4M_MAX_MM) {
        return 'near';
    }
    return 'far';
}

export function squareLengthTierBandEdgeFractions(): {closeNear: number; nearFar: number} {
    const span = CHARUCO_SQUARE_MM_MAX - CHARUCO_SQUARE_MM_MIN;
    if (span <= 0) {
        return {closeNear: 1, nearFar: 1};
    }
    return {
        closeNear: (SQUARE_LENGTH_LT_2M_MAX_MM - CHARUCO_SQUARE_MM_MIN) / span,
        nearFar: (SQUARE_LENGTH_LT_4M_MAX_MM - CHARUCO_SQUARE_MM_MIN) / span,
    };
}

export const BOARD_GRID_MIN = 2;
export const BOARD_GRID_MAX = 40;

/**
 * Smallest square length (mm) allowed at a working distance. Distance bands are minimums, not ranges:
 * a large square is fine at any distance, but squares below the band are too small to detect from there.
 */
export function workingDistanceMinSquareMm(tier: WorkingDistanceTierId): number {
    if (tier === 'far') {
        return SQUARE_LENGTH_LT_4M_MAX_MM + 1;
    }
    if (tier === 'near') {
        return SQUARE_LENGTH_LT_2M_MAX_MM + 1;
    }
    return CHARUCO_SQUARE_MM_MIN;
}

/** Largest square length that prints on exactly `pages` sheets, or `null` if no square length does. */
export function maxSquareMmForGridAndPages(
    squaresX: number,
    squaresY: number,
    paperWMm: number,
    paperHMm: number,
    pages: number,
): number | null {
    return gridFeasibility(squaresX, squaresY, paperWMm, paperHMm).maxSquareMmByPageCount.get(pages) ?? null;
}

/**
 * Page counts the Pages slider offers, ascending: each prints exactly that many sheets at its largest
 * square length, and that square is at least `minSquareMm` (the working distance minimum). The last is
 * one square per sheet at the largest square length that prints.
 */
export function validTargetPageCountsForGrid(
    squaresX: number,
    squaresY: number,
    paperWMm: number,
    paperHMm: number,
    minSquareMm: number = CHARUCO_SQUARE_MM_MIN,
): number[] {
    const f = gridFeasibility(squaresX, squaresY, paperWMm, paperHMm);
    return f.pageCounts.filter((p) => f.maxSquareMmByPageCount.get(p)! >= minSquareMm);
}

/** Square lengths (mm) that print on this paper, ascending. */
export function enumerateValidSquareSizes(
    squaresX: number,
    squaresY: number,
    paperWMm: number,
    paperHMm: number,
): number[] {
    return gridFeasibility(squaresX, squaresY, paperWMm, paperHMm).validSquaresMm;
}

/** Nearest printable square length at or above `minSquareMm` (ties go smaller), or `null` if none exists. */
export function snapSquareMm(
    raw: number,
    squaresX: number,
    squaresY: number,
    paperWMm: number,
    paperHMm: number,
    minSquareMm: number = CHARUCO_SQUARE_MM_MIN,
): number | null {
    const target = Math.round(Math.max(CHARUCO_SQUARE_MM_MIN, Math.min(CHARUCO_SQUARE_MM_MAX, raw)));
    let best: number | null = null;
    for (const s of enumerateValidSquareSizes(squaresX, squaresY, paperWMm, paperHMm)) {
        if (s >= minSquareMm && (best === null || Math.abs(s - target) < Math.abs(best - target))) {
            best = s;
        }
    }
    return best;
}

export interface CharucoPagePreviewRect {
    sheetIndex: number;
    left: number;
    top: number;
    width: number;
    height: number;
}

/** Full-chart overlay rects (fractions of the preview canvas), one per printed sheet from {@link buildPageSpecs}. */
export function computeCharucoPagePreviewRects(
    squaresX: number,
    squaresY: number,
    tiling: TilingInfo,
    previewCanvasW: number,
    previewCanvasH: number,
): CharucoPagePreviewRect[] | null {
    if (tiling.pageCount <= 1 || squaresX < 1 || squaresY < 1) {
        return null;
    }
    const pw = Math.max(1, Math.round(previewCanvasW));
    const ph = Math.max(1, Math.round(previewCanvasH));
    const layout = charucoBoardPixelLayout(pw, ph, squaresX, squaresY);
    return buildPageSpecs(squaresX, squaresY, tiling).pages.map((r) => {
        const [l, rPx] = charucoCropXRange(r.gx0, r.gx1, layout);
        const [t, bPx] = charucoCropYRange(r.gy0, r.gy1, layout);
        return {
            sheetIndex: r.sheetIndex,
            left: l / pw,
            top: t / ph,
            width: (rPx - l) / pw,
            height: (bPx - t) / ph,
        };
    });
}

export function charucoPagePreviewBorderColor(
    sheetIndex1Based: number,
    totalPages: number,
    darkMode: boolean,
): string {
    if (totalPages <= 1) {
        return darkMode ? 'hsl(0, 0%, 50%)' : 'hsl(0, 0%, 75%)';
    }
    const i = sheetIndex1Based - 1;
    const hue = (360 * i) / totalPages;
    const sat = 78;
    const light = darkMode ? 62 : 40;
    return `hsl(${hue} ${sat}% ${light}%)`;
}

/** The layout printed for this board: exactly squaresX×squaresY, fewest sheets, best paper orientation. */
export function computeEffectivePrintLayout(
    squaresX: number,
    squaresY: number,
    squareMm: number,
    paperWMm: number,
    paperHMm: number,
): TilingInfo | null {
    return printedLayout(squaresX, squaresY, squareMm, paperWMm, paperHMm);
}

export function layoutSummaryText(
    tiling: TilingInfo | null,
    squaresX: number,
    squaresY: number,
    squareMm: number,
    sheetCountOne: (n: number) => string,
    sheetArrangement: (cols: number, rows: number) => string,
    layoutStats: (sx: number, sy: number, mm: number) => string,
    layoutCannotFit: string,
): string {
    if (!tiling) {
        return layoutCannotFit;
    }
    const partA = sheetCountOne(tiling.pageCount);
    const partC =
        tiling.pageCount > 1 ? sheetArrangement(tiling.npx, tiling.npy) : '';
    const partD = layoutStats(squaresX, squaresY, squareMm);
    return `${partA}${partC}${partD}`;
}
