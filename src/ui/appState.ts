/**
 * The board and print settings the controls set, and what follows from them: the printed layout, the
 * print-shop board and what the chart link describes. Every UI module reads and changes this one `state`.
 */
import {
    BOARD_GRID_MIN,
    boardGridAxisMax,
    CHARUCO_SQUARE_MM_MAX,
    DEFAULT_WORKING_DISTANCE,
    maxSquareMmForGridAndPages,
    printedLayout,
    resolveDistancePrintPlan,
    snapSquareMm,
    workingDistanceTierFromSquareLengthMm,
    type WorkingDistanceTierId,
} from '../print/charucoLayout.js';
import {paperById, type PaperId} from '../print/papers.js';
import type {PrintedChart} from '../print/svgDocument.js';
import type {LinkTarget, PrintMode, ShopPrintOptions, ShopSizeId, ShopUnit} from '../print/charucoDocUrl.js';
import {SHOP_SQUARE_MM_MAX, shopUnitForRegion} from '../print/shopSizes.js';
import {maxShopGridForSquare, resolveShopDistancePlan, shopSheetLayout, snapShopSquareMm} from '../print/shopLayout.js';
import {defaultPaperId, defaultRegion, prefersImperialUnits} from './locale.js';

/** Imperial units in the UI copy (distances, chart sizes, people's heights); the locale is read once. */
export const IMPERIAL = prefersImperialUnits();

interface AppState {
    distanceId: WorkingDistanceTierId;
    /** "My printer" (tiled sheets of `paperId`) or "Print shop" (one board of `shopSizeId`). */
    mode: PrintMode;
    /** Home paper; kept while in print-shop mode so switching back restores it. */
    paperId: PaperId;
    squareMm: number;
    squaresX: number;
    squaresY: number;
    autoGrid: boolean;
    /** Print-shop mm | in toggle: standard bleed, which sizes are listed and searched first, readouts. */
    shopUnit: ShopUnit;
    /** Print-shop board size; set whenever the mode is `shop`. */
    shopSizeId: ShopSizeId | null;
    shopBleed: ShopPrintOptions['bleed'];
    shopCropMarks: boolean;
}

/** Print-file options remembered for a fresh print-shop session; a chart link always wins. */
const SHOP_OPTIONS_STORAGE_KEY = 'skellychart.shopOptions';

function storedShopOptions(): Pick<AppState, 'shopBleed' | 'shopCropMarks'> {
    const fallback = {shopBleed: 'std' as const, shopCropMarks: false};
    try {
        const v = JSON.parse(localStorage.getItem(SHOP_OPTIONS_STORAGE_KEY) ?? 'null') as {bleed?: unknown; cropMarks?: unknown} | null;
        const bleed = v?.bleed === 'std' ? 'std' : typeof v?.bleed === 'number' && v.bleed >= 0 && v.bleed <= 25 ? {mm: v.bleed} : 'std';
        return {shopBleed: bleed, shopCropMarks: v?.cropMarks === true};
    } catch {
        return fallback;
    }
}

export function storeShopOptions(): void {
    try {
        const bleed = state.shopBleed === 'std' ? 'std' : state.shopBleed.mm;
        localStorage.setItem(SHOP_OPTIONS_STORAGE_KEY, JSON.stringify({bleed, cropMarks: state.shopCropMarks}));
    } catch {
        /* storage unavailable: the options still apply to this session */
    }
}

export const state: AppState = {
    distanceId: DEFAULT_WORKING_DISTANCE,
    mode: 'home',
    paperId: defaultPaperId(),
    // Placeholders until boot() applies the distance preset (npm run check:presets checks every one prints).
    squareMm: 54,
    squaresX: 5,
    squaresY: 3,
    autoGrid: true,
    shopUnit: shopUnitForRegion(defaultRegion()),
    shopSizeId: null,
    ...storedShopOptions(),
};

export function paperDims() {
    return paperById(state.paperId);
}

function autoPlan() {
    return resolveDistancePrintPlan(state.distanceId, state.paperId);
}

export function applyAutoPreset(): void {
    if (!state.autoGrid) {
        return;
    }
    if (state.mode === 'shop') {
        const shopPlan = resolveShopDistancePlan(state.distanceId, state.shopUnit);
        if (shopPlan) {
            state.squaresX = shopPlan.squaresX;
            state.squaresY = shopPlan.squaresY;
            state.squareMm = shopPlan.squareMm;
            state.shopSizeId = shopPlan.sizeId;
        }
        return;
    }
    const plan = autoPlan();
    const pd = paperDims();
    const maxSq = maxSquareMmForGridAndPages(plan.squaresX, plan.squaresY, pd.wMm, pd.hMm, plan.targetPages);
    if (maxSq !== null) {
        state.squaresX = plan.squaresX;
        state.squaresY = plan.squaresY;
        state.squareMm = maxSq;
    }
}

/**
 * The one printed layout every output reads (sliders, summary, preview, print, PDF, QR): the board is
 * exactly squaresX×squaresY as set on the sliders, never transposed.
 */
export function effectiveTiling() {
    const pd = paperDims();
    return printedLayout(state.squaresX, state.squaresY, state.squareMm, pd.wMm, pd.hMm);
}

/**
 * The home chart as the controls set it now, or `null` when it does not print. Preview, Print and Save
 * take one before their first await and read only it, so a control change mid-render cannot mix two
 * charts (or a file name from another).
 */
export function snapshotChart(): PrintedChart | null {
    const tiling = effectiveTiling();
    return tiling
        ? {paperId: state.paperId, squaresX: state.squaresX, squaresY: state.squaresY, squareMm: state.squareMm, tiling}
        : null;
}

/** The print-shop board as laid out on its size, or `null` (home mode, or it does not fit). */
export function shopLayoutNow() {
    return state.mode === 'shop' && state.shopSizeId
        ? shopSheetLayout(state.squaresX, state.squaresY, state.squareMm, state.shopSizeId)
        : null;
}

export function shopOptions(): ShopPrintOptions {
    return {bleed: state.shopBleed, cropMarks: state.shopCropMarks, colour: 'colour'};
}

/** What the chart link and QR describe: the home paper, or the print-shop board and its options. */
export function linkTarget(): PaperId | LinkTarget {
    return state.mode === 'shop' && state.shopSizeId
        ? {kind: 'shop', size: {id: state.shopSizeId, unit: state.shopUnit}, options: shopOptions()}
        : state.paperId;
}

/** Whether the current mode has something to print and export. */
export function hasPrintableLayout(): boolean {
    if (state.mode === 'shop') {
        return shopLayoutNow() !== null;
    }
    return effectiveTiling() !== null;
}

/** The square slider's end: print-shop boards go up to {@link SHOP_SQUARE_MM_MAX}. */
export function squareSliderMaxMm(): number {
    return state.mode === 'shop' ? SHOP_SQUARE_MM_MAX : CHARUCO_SQUARE_MM_MAX;
}

/** Nearest square length the board prints at in the current mode. */
export function snapSquareForMode(raw: number): number | null {
    if (state.mode === 'shop') {
        return state.shopSizeId ? snapShopSquareMm(raw, state.squaresX, state.squaresY, state.shopSizeId) : null;
    }
    const pd = paperDims();
    return snapSquareMm(raw, state.squaresX, state.squaresY, pd.wMm, pd.hMm);
}

/** Chart sheets the printed layout uses, excluding the guide sheet; 1 when nothing fits. */
export function chartPageCount(tiling: ReturnType<typeof effectiveTiling>): number {
    return tiling?.pageCount ?? 1;
}

/**
 * Square length is the distance slider: the distance drop-down only presets it, so when the square moves
 * into another band the drop-down follows instead of blocking it.
 */
export function setSquareFollowingBand(squareMm: number): void {
    const bandBefore = workingDistanceTierFromSquareLengthMm(state.squareMm);
    const bandAfter = workingDistanceTierFromSquareLengthMm(squareMm);
    if (bandAfter !== bandBefore) {
        state.distanceId = bandAfter;
    }
    state.squareMm = squareMm;
}

/**
 * X / Y keep the square length (so they never change the distance); the page count follows. Every grid
 * prints every square length up to the paper's limit; the only end-stop is the marker dictionary, so
 * each axis stops where the board would need more than 250 markers.
 */
export function setGridSize(axis: 'squaresX' | 'squaresY', requested: number): void {
    const other = axis === 'squaresX' ? state.squaresY : state.squaresX;
    let max = boardGridAxisMax(other);
    if (state.mode === 'shop' && state.shopSizeId) {
        // Print shop: one board, so X / Y also stop where the board would outgrow the chosen size.
        max = Math.min(max, maxShopGridForSquare(axis, other, state.squareMm, state.shopSizeId) ?? BOARD_GRID_MIN);
    }
    state[axis] = clampInt(requested, BOARD_GRID_MIN, max);
}

export function clampInt(n: number, lo: number, hi: number): number {
    return Math.round(Math.max(lo, Math.min(hi, n)));
}
