/**
 * Print layout + preset rules matching freemocap `charucoPrintLayout.ts`
 * (tiling math is in `tiling.ts`; this module adds UI presets and snapping).
 */
import {
    computeTilingInfo,
    computeTilingInfoMatchingPageCount,
    type TilingInfo,
} from './tiling.js';
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

export const CHARUCO_SQUARE_MM_MIN = 10;
export const CHARUCO_SQUARE_MM_MAX = 200;

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
export const PAGE_COUNT_MIN = 1;
export const PAGE_COUNT_MAX = 9;

const SQ_MIN = CHARUCO_SQUARE_MM_MIN;
const SQ_MAX = CHARUCO_SQUARE_MM_MAX;

/** Full scan is ~191 tiling checks; runs on every slider `input` — cache per grid + paper. */
let validSquareSizesCacheKey = '';
let validSquareSizesCache: number[] = [];
const validSquareSizesForSheetsCache = new Map<string, number[]>();
/** `maxSquareMmForGridAndPages` memo; scan order is optimised (descending) for typical hit rate. */
const maxSquareMmForGridAndPagesCache = new Map<string, number | null>();
/** Memo: `syncUi` called every frame while dragging squares — avoid re-walking targets 1..9 repeatedly. */
const validTargetPageCountsForGridCache = new Map<string, number[]>();

export function maxSquareMmForGridAndPages(
    squaresX: number,
    squaresY: number,
    paperWMm: number,
    paperHMm: number,
    targetPages: number,
): number | null {
    const key = `${squaresX}:${squaresY}:${paperWMm}:${paperHMm}:${targetPages}`;
    if (maxSquareMmForGridAndPagesCache.has(key)) {
        return maxSquareMmForGridAndPagesCache.get(key)!;
    }
    for (let s = SQ_MAX; s >= SQ_MIN; s--) {
        const t = computeTilingInfoMatchingPageCount(squaresX, squaresY, s, paperWMm, paperHMm, targetPages);
        if (t !== null) {
            maxSquareMmForGridAndPagesCache.set(key, s);
            return s;
        }
    }
    maxSquareMmForGridAndPagesCache.set(key, null);
    return null;
}

export function validTargetPageCountsForGrid(
    squaresX: number,
    squaresY: number,
    paperWMm: number,
    paperHMm: number,
): number[] {
    const key = `${squaresX}:${squaresY}:${paperWMm}:${paperHMm}`;
    const cached = validTargetPageCountsForGridCache.get(key);
    if (cached !== undefined) {
        return cached;
    }
    const out: number[] = [];
    for (let p = PAGE_COUNT_MIN; p <= PAGE_COUNT_MAX; p++) {
        let any = false;
        for (let s = SQ_MIN; s <= SQ_MAX; s++) {
            // Existence-only: stops as soon as *some* square length satisfies `p` sheets (much cheaper than
            // walking all `s` to find the maximum, which `maxSquareMmForGridAndPages` does when needed).
            if (computeTilingInfoMatchingPageCount(squaresX, squaresY, s, paperWMm, paperHMm, p) !== null) {
                any = true;
                break;
            }
        }
        if (any) {
            out.push(p);
        }
    }
    validTargetPageCountsForGridCache.set(key, out);
    return out;
}

export function enumerateValidSquareSizes(
    squaresX: number,
    squaresY: number,
    paperWMm: number,
    paperHMm: number,
): number[] {
    const key = `${squaresX}:${squaresY}:${paperWMm}:${paperHMm}`;
    if (key === validSquareSizesCacheKey) {
        return validSquareSizesCache;
    }
    const out = new Set<number>();
    for (let s = SQ_MIN; s <= SQ_MAX; s++) {
        if (computeTilingInfo(squaresX, squaresY, s, paperWMm, paperHMm) !== null) {
            out.add(s);
        }
    }
    validSquareSizesCache = [...out].sort((a, b) => a - b);
    validSquareSizesCacheKey = key;
    return validSquareSizesCache;
}

export function enumerateValidSquareSizesForGridMatchingSheetsTarget(
    squaresX: number,
    squaresY: number,
    paperWMm: number,
    paperHMm: number,
    targetSheets: number,
): number[] {
    const key = `${squaresX}:${squaresY}:${paperWMm}:${paperHMm}:${targetSheets}`;
    const hit = validSquareSizesForSheetsCache.get(key);
    if (hit) {
        return hit;
    }
    const out = new Set<number>();
    for (let s = SQ_MIN; s <= SQ_MAX; s++) {
        if (
            computeTilingInfoMatchingPageCount(squaresX, squaresY, s, paperWMm, paperHMm, targetSheets) !== null
        ) {
            out.add(s);
        }
    }
    const sorted = [...out].sort((a, b) => a - b);
    validSquareSizesForSheetsCache.set(key, sorted);
    return sorted;
}

export function nearestValidTargetPages(
    desired: number,
    squaresX: number,
    squaresY: number,
    paperWMm: number,
    paperHMm: number,
): number {
    const valid = validTargetPageCountsForGrid(squaresX, squaresY, paperWMm, paperHMm);
    const d0 = Math.round(Math.max(PAGE_COUNT_MIN, Math.min(PAGE_COUNT_MAX, desired)));
    if (valid.length === 0) {
        return d0;
    }
    let best = valid[0]!;
    let bestDist = Math.abs(best - d0);
    for (const v of valid) {
        const d = Math.abs(v - d0);
        if (d < bestDist || (d === bestDist && v < best)) {
            best = v;
            bestDist = d;
        }
    }
    return best;
}

export function snapSquareMm(
    raw: number,
    squaresX: number,
    squaresY: number,
    paperWMm: number,
    paperHMm: number,
): number {
    const target = Math.round(Math.max(SQ_MIN, Math.min(SQ_MAX, raw)));
    const valid = enumerateValidSquareSizes(squaresX, squaresY, paperWMm, paperHMm);
    if (valid.length === 0) {
        return target;
    }
    let best = valid[0]!;
    let bestDist = Math.abs(best - target);
    for (const v of valid) {
        const d = Math.abs(v - target);
        if (d < bestDist || (d === bestDist && v < best)) {
            best = v;
            bestDist = d;
        }
    }
    return best;
}

export interface CharucoPageSquareRegion {
    sheetIndex: number;
    gx0: number;
    gx1: number;
    gy0: number;
    gy1: number;
}

export function computeCharucoPageSquareRegions(
    squaresX: number,
    squaresY: number,
    tiling: TilingInfo,
): CharucoPageSquareRegion[] {
    const {maxCx, maxCyFirst, maxCyRest, npx} = tiling;
    const rowRanges: [number, number][] = [];
    let gy = 0;
    while (gy < squaresY) {
        const cap = gy === 0 ? maxCyFirst : maxCyRest;
        const gyEnd = Math.min(gy + cap, squaresY);
        rowRanges.push([gy, gyEnd]);
        gy = gyEnd;
    }
    let sheet = 0;
    const out: CharucoPageSquareRegion[] = [];
    for (const [gy0, gy1] of rowRanges) {
        for (let col = 0; col < npx; col++) {
            sheet += 1;
            const gx0 = col * maxCx;
            const gx1 = Math.min(gx0 + maxCx, squaresX);
            out.push({sheetIndex: sheet, gx0, gx1, gy0, gy1});
        }
    }
    return out;
}

export interface CharucoPagePreviewRect {
    sheetIndex: number;
    left: number;
    top: number;
    width: number;
    height: number;
}

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
    return computeCharucoPageSquareRegions(squaresX, squaresY, tiling).map((r) => {
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

/** Effective tiling for UI (matches freemocap `CharucoPrintPage` useMemo). */
export function computeEffectiveTiling(
    squaresX: number,
    squaresY: number,
    squareMm: number,
    paperWMm: number,
    paperHMm: number,
    autoGrid: boolean,
    targetPagesWhenAuto: number,
): TilingInfo | null {
    if (autoGrid) {
        const matched = computeTilingInfoMatchingPageCount(
            squaresX,
            squaresY,
            squareMm,
            paperWMm,
            paperHMm,
            targetPagesWhenAuto,
        );
        if (matched !== null) {
            return matched;
        }
    }
    return computeTilingInfo(squaresX, squaresY, squareMm, paperWMm, paperHMm);
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
