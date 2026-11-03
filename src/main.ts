import {APP_VERSION} from './appVersion.js';
import {IS_DEV} from './env.js';
import freemocapLogoUrl from './freemocapLogoUrl.js';
import {printOrder, renderCharucoPrintSvg, type PrintedChart} from './print/svgDocument.js';
import {svgAssembledChartWithSheetNumbers} from './print/assemblyGuideSvg.js';
import {
    BOARD_GRID_MAX,
    BOARD_GRID_MIN,
    BOARD_MARKERS_MAX,
    boardGridAxisMax,
    CHARUCO_SQUARE_MM_MAX,
    CHARUCO_SQUARE_MM_MIN,
    DEFAULT_WORKING_DISTANCE,
    isWorkingDistanceId,
    layoutSummaryText,
    maxSquareMmForGridAndPages,
    printedLayout,
    resolveDistancePrintPlan,
    sheetColorRgb,
    snapSquareMm,
    squareLengthTierBandEdgeFractions,
    pageStepNeighbours,
    steppablePageCounts,
    type PageStep,
    WORKING_DISTANCES,
    workingDistanceMinSquareMm,
    workingDistanceTierFromSquareLengthMm,
    type WorkingDistanceTierId,
} from './print/charucoLayout.js';
import {isPaperId, paperById, PAPERS, type PaperId} from './print/papers.js';
import {gridFeasibility} from './print/feasibilityRules.js';
import {printedSheetCount} from './print/tiling.js';
import {perfLog} from './print/perfDebug.js';
import {PIXELS_PER_MM} from './print/constants.js';
import {compareChartVersions, parseChartVersion} from './print/chartVersion.js';
import {rgbCss, svgRootOuterSizeAttrs} from './print/svgUtils.js';
import {
    buildCharucoDocumentationUrl,
    parseCharucoQrSearchParams,
    shopStandardBleedMm,
    type LinkTarget,
    type PrintMode,
    type ShopPrintOptions,
    type ShopSizeId,
    type ShopUnit,
} from './print/charucoDocUrl.js';
import {
    bleedMmForUnit,
    formatShopBleed,
    formatShopDims,
    formatShopTrim,
    pageSizeMm,
    SHOP_SQUARE_MM_MAX,
    SHOP_TRIM_MAX_MM,
    shopBleedChoices,
    shopSizeById,
    shopSizeGroups,
    shopSizeOptionLabel,
    shopUnitForRegion,
} from './print/shopSizes.js';
import {
    maxShopGridForSquare,
    maxShopSquareMm,
    resolveShopDistancePlan,
    shopQuietZoneMm,
    shopSheetLayout,
    smallestFittingShopSize,
    snapShopSquareMm,
} from './print/shopLayout.js';
import {
    getQrLinkTarget,
    isQrLinkTargetSwitchAvailable,
    resolveQrLinkSourceUrl,
    resolveQrLinkSourceUrlFor,
    setQrLinkTarget,
} from './print/qrLinkTarget.js';
import {
    MAX_PREVIEW_PAGES,
    PREVIEW_DEBOUNCE_IDLE_MS,
    PREVIEW_DEBOUNCE_INTERACTIVE_MS,
    svgToDataUrl,
} from './ui/previewSvg.js';
import {buildPdfBlobFromSvgPages} from './ui/pdfExport.js';
import {mountScaleScene} from './ui/scaleScene.js';
import {yieldToMain, yieldToMainUnlessAborted} from './ui/yieldToMain.js';
import {
    applyThemePreference,
    getStoredPreference,
    initTheme,
    setStoredPreference,
    type ThemePreference,
} from './ui/theme.js';
import {defaultPaperId, defaultRegion, prefersImperialUnits} from './ui/locale.js';
import {
    FREEMOCAP_CALIBRATION_DOCS_MULTI_CAM_URL,
    distanceLabel,
    distanceSelectLabel,
    interpolate,
    paperLabel,
    paperOptionDimensions,
    S,
    sheetCountPhrase,
    sheetsShort,
} from './ui/strings.js';

function initialBoard(): {paperId: PaperId; squareMm: number; squaresX: number; squaresY: number} {
    const paperId = defaultPaperId();
    const paper = paperById(paperId);
    const plan = resolveDistancePrintPlan(DEFAULT_WORKING_DISTANCE, paperId);
    const squareMm = maxSquareMmForGridAndPages(plan.squaresX, plan.squaresY, paper.wMm, paper.hMm, plan.targetPages);
    if (squareMm === null) {
        throw new Error(`The ${paperId} ${DEFAULT_WORKING_DISTANCE} preset does not print (npm run check:presets catches this).`);
    }
    return {paperId, squareMm, squaresX: plan.squaresX, squaresY: plan.squaresY};
}

const defaultBoard = initialBoard();

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

function storeShopOptions(): void {
    try {
        const bleed = state.shopBleed === 'std' ? 'std' : state.shopBleed.mm;
        localStorage.setItem(SHOP_OPTIONS_STORAGE_KEY, JSON.stringify({bleed, cropMarks: state.shopCropMarks}));
    } catch {
        /* storage unavailable: the options still apply to this session */
    }
}

const state: AppState = {
    distanceId: DEFAULT_WORKING_DISTANCE,
    mode: 'home',
    paperId: defaultBoard.paperId,
    squareMm: defaultBoard.squareMm,
    squaresX: defaultBoard.squaresX,
    squaresY: defaultBoard.squaresY,
    autoGrid: true,
    shopUnit: shopUnitForRegion(defaultRegion()),
    shopSizeId: null,
    ...storedShopOptions(),
};

/** Shown under the mode toggle after a mode switch (refused, or the square shrank); cleared by the next change. */
let modeNotice: string | null = null;
/** Shown under the board size after picking a size too small for the working distance; cleared by the next change. */
let shopSizeHint: string | null = null;

function clearTransientNotices(): void {
    modeNotice = null;
    shopSizeHint = null;
}

/** Set from chart QR link query params; shown once at load (not cleared by `syncUi`). */
let qrVersionBannerMessage: string | null = null;

/**
 * Square length (mm) a chart link asked for that could not print on the current paper. A paper change
 * re-fits from it (so switching to the chart's paper restores it) until the user moves a board control.
 */
let linkSquareMm: number | null = null;

function byId(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) {
        throw new Error(`Missing #${id}`);
    }
    return el;
}

function setPreviewBusyMarkup(root: HTMLElement, message: string): void {
    root.replaceChildren();
    const spin = document.createElement('span');
    spin.className = 'preview-busy-ring';
    spin.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'preview-busy-msg preview-busy-msg--dots';
    label.textContent = message;
    root.append(spin, label);
}

function setThumbGridPlaceholder(message: string): void {
    const thumbs = byId('thumbGrid');
    thumbs.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'thumb-grid-loading thumb-grid-loading--busy';
    setPreviewBusyMarkup(box, message);
    thumbs.appendChild(box);
}

/** Empties the preview: no sheets, so nothing that describes them (e.g. after a render error). */
function clearPreview(): void {
    byId('fullChartHint').classList.add('hidden');
    byId('previewTruncated').classList.add('hidden');
    byId('thumbGrid').innerHTML = '';
    scaleScene?.update(null);
}

function paperDims() {
    return paperById(state.paperId);
}

function autoPlan() {
    return resolveDistancePrintPlan(state.distanceId, state.paperId);
}

function applyAutoPreset(): void {
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
function effectiveTiling() {
    const pd = paperDims();
    return printedLayout(state.squaresX, state.squaresY, state.squareMm, pd.wMm, pd.hMm);
}

/**
 * The home chart as the controls set it now, or `null` when it does not print. Preview, Print and Save
 * take one before their first await and read only it, so a control change mid-render cannot mix two
 * charts (or a file name from another).
 */
function snapshotChart(): PrintedChart | null {
    const tiling = effectiveTiling();
    return tiling
        ? {paperId: state.paperId, squaresX: state.squaresX, squaresY: state.squaresY, squareMm: state.squareMm, tiling}
        : null;
}

/** The print-shop board as laid out on its size, or `null` (home mode, or it does not fit). */
function shopLayoutNow() {
    return state.mode === 'shop' && state.shopSizeId
        ? shopSheetLayout(state.squaresX, state.squaresY, state.squareMm, state.shopSizeId)
        : null;
}

function shopOptions(): ShopPrintOptions {
    return {bleed: state.shopBleed, cropMarks: state.shopCropMarks, colour: 'colour'};
}

/** What the chart link and QR describe: the home paper, or the print-shop board and its options. */
function linkTarget(): PaperId | LinkTarget {
    return state.mode === 'shop' && state.shopSizeId
        ? {kind: 'shop', size: {id: state.shopSizeId, unit: state.shopUnit}, options: shopOptions()}
        : state.paperId;
}

/** Whether the current mode has something to print and export. */
function hasPrintableLayout(): boolean {
    if (state.mode === 'shop') {
        return shopLayoutNow() !== null;
    }
    return effectiveTiling() !== null;
}

/** The square slider's end: print-shop boards go up to {@link SHOP_SQUARE_MM_MAX}. */
function squareSliderMaxMm(): number {
    return state.mode === 'shop' ? SHOP_SQUARE_MM_MAX : CHARUCO_SQUARE_MM_MAX;
}

/** Nearest square length the board prints at in the current mode. */
function snapSquareForMode(raw: number): number | null {
    if (state.mode === 'shop') {
        return state.shopSizeId ? snapShopSquareMm(raw, state.squaresX, state.squaresY, state.shopSizeId) : null;
    }
    const pd = paperDims();
    return snapSquareMm(raw, state.squaresX, state.squaresY, pd.wMm, pd.hMm);
}

/**
 * The board on a print-shop size: its own square if some size takes it, else the largest smaller square
 * in its distance band that one does. `null` if none does.
 */
function shopFitForBoard(): {squareMm: number; sizeId: ShopSizeId} | null {
    const bandMin = Math.min(workingDistanceMinSquareMm(state.distanceId), state.squareMm);
    for (let squareMm = Math.min(state.squareMm, SHOP_SQUARE_MM_MAX); squareMm >= bandMin; squareMm--) {
        const sizeId = smallestFittingShopSize(state.squaresX, state.squaresY, squareMm, state.shopUnit);
        if (sizeId) {
            return {squareMm, sizeId};
        }
    }
    return null;
}

/**
 * The print-shop board left for home paper, when the square had to shrink to print there. Switching back
 * with the board untouched restores its square and size.
 */
let shopBoardBeforeHome: {squaresX: number; squaresY: number; homeSquareMm: number; squareMm: number; sizeId: ShopSizeId} | null =
    null;

/**
 * Switches between "My printer" and "Print shop". X, Y and the distance never change without telling the
 * user: entering print-shop mode keeps the board on the smallest size that fits it, shrinks the square
 * within its band if it must (with a notice), or refuses (with a message). Leaving it keeps the square if
 * the home paper prints it, else the nearest that does (with a notice).
 */
function setMode(mode: PrintMode): void {
    if (mode === state.mode) {
        return;
    }
    clearTransientNotices();
    const back = shopBoardBeforeHome;
    shopBoardBeforeHome = null;
    if (
        mode === 'shop' &&
        !state.autoGrid &&
        back &&
        back.squaresX === state.squaresX &&
        back.squaresY === state.squaresY &&
        back.homeSquareMm === state.squareMm &&
        shopSheetLayout(state.squaresX, state.squaresY, back.squareMm, back.sizeId)
    ) {
        setSquareFollowingBand(back.squareMm);
        state.shopSizeId = back.sizeId;
    } else if (mode === 'shop' && !state.autoGrid) {
        const fit = shopFitForBoard();
        if (!fit) {
            modeNotice = S.shopModeNoFit;
            syncUi();
            return;
        }
        if (fit.squareMm !== state.squareMm) {
            modeNotice = interpolate(S.shopModeSnapped, {from: state.squareMm, to: fit.squareMm});
        }
        state.squareMm = fit.squareMm;
        state.shopSizeId = fit.sizeId;
    }
    const shopBoard = {squareMm: state.squareMm, sizeId: state.shopSizeId};
    state.mode = mode;
    if (mode === 'home' && !state.autoGrid) {
        // Print-shop squares may be larger than home paper allows; keep the nearest that prints.
        const snapped = snapSquareForMode(state.squareMm);
        if (snapped !== null && snapped !== shopBoard.squareMm) {
            modeNotice = interpolate(S.homeModeSnapped, {from: shopBoard.squareMm, to: snapped, paper: paperLabel(state.paperId)});
            if (shopBoard.sizeId) {
                shopBoardBeforeHome = {
                    squaresX: state.squaresX,
                    squaresY: state.squaresY,
                    homeSquareMm: snapped,
                    squareMm: shopBoard.squareMm,
                    sizeId: shopBoard.sizeId,
                };
            }
            setSquareFollowingBand(snapped);
        }
    }
    forgetLinkSquare();
    syncUi({previewDelayMs: 0});
}

function pagesSliderDisplay(tiling: ReturnType<typeof effectiveTiling>): number {
    return tiling?.pageCount ?? 1;
}

/**
 * Stops of the sheets stepper for the current grid, paper and working distance: they end-stop at the
 * distance's minimum square length and never change the distance.
 */
function pageSteps(): PageStep[] {
    const pd = paperDims();
    return steppablePageCounts(state.squaresX, state.squaresY, pd.wMm, pd.hMm, workingDistanceMinSquareMm(state.distanceId));
}

type PageStepTarget = 'fewer' | 'more' | 'fewest' | 'most';

/**
 * Moves the sheets stepper: sets the square length to the largest that prints the chosen page count.
 * Like the other board sliders it never changes the distance. Returns false when there is nowhere to go.
 */
function stepPages(which: PageStepTarget): boolean {
    const current = pagesSliderDisplay(effectiveTiling());
    const target = pageStepNeighbours(pageSteps(), current)[which];
    if (!target || target.pages === current) {
        return false;
    }
    state.autoGrid = false;
    forgetLinkSquare();
    state.squareMm = target.squareMm;
    scheduleSyncUi();
    return true;
}

/** Assembled chart size for the stepper readout, in cm (or inches with imperial units). */
function chartSizeParts(imperial: boolean): {w: string; h: string; unit: string} {
    const fmt = (v: number): string => v.toLocaleString(undefined, {maximumFractionDigits: 1});
    const wMm = state.squaresX * state.squareMm;
    const hMm = state.squaresY * state.squareMm;
    return imperial
        ? {w: fmt(wMm / 25.4), h: fmt(hMm / 25.4), unit: 'in'}
        : {w: fmt(wMm / 10), h: fmt(hMm / 10), unit: 'cm'};
}

/** A sheets stepper button: how many sheets the step adds or removes, and the square length it gives. */
function renderPageStepButton(
    btn: HTMLElement,
    step: PageStep | null,
    currentPages: number,
    sign: string,
    noneLabel: string,
    ariaTemplate: string,
): void {
    const main = btn.querySelector('.page-step-main')!;
    const sub = btn.querySelector('.page-step-sub')!;
    // aria-disabled (not disabled) keeps keyboard focus on the button when it reaches an end stop.
    btn.setAttribute('aria-disabled', String(step === null));
    if (step) {
        const total = printedSheetCount(step.pages);
        const change = sheetsShort(Math.abs(total - printedSheetCount(currentPages)));
        main.textContent = `${sign} ${change}`;
        sub.textContent = interpolate(S.pagesStepSquares, {mm: step.squareMm});
        btn.setAttribute(
            'aria-label',
            interpolate(ariaTemplate, {change, total: sheetsShort(total), mm: step.squareMm}),
        );
    } else {
        main.textContent = `${sign} ${noneLabel}`;
        sub.textContent = '';
        btn.setAttribute('aria-label', noneLabel);
    }
}

/** Sheets stepper: the printed page count, the stops either side, and why it stops at an end. */
function syncPageStepper(tiling: ReturnType<typeof effectiveTiling>, imperial: boolean): void {
    const count = pagesSliderDisplay(tiling);
    const {fewer, more} = tiling ? pageStepNeighbours(pageSteps(), count) : {fewer: null, more: null};
    byId('lbl-pages').textContent = S.sheetsOfPaper;
    byId('pagesValue').textContent = tiling ? sheetsShort(printedSheetCount(count)) : '—';
    const size = chartSizeParts(imperial);
    byId('pagesDetail').textContent = !tiling
        ? ''
        : tiling.pageCount > 1
          ? interpolate(S.pagesDetail, {cols: tiling.npx, rows: tiling.npy, ...size})
          : interpolate(S.pagesDetailOne, size);
    renderPageStepButton(byId('pagesFewer'), fewer, count, '−', S.pagesFewerNone, S.pagesFewerAria);
    renderPageStepButton(byId('pagesMore'), more, count, '+', S.pagesMoreNone, S.pagesMoreAria);

    let hint = '';
    if (tiling && !fewer && count > 1) {
        const pd = paperDims();
        const fewestAnyDistance = gridFeasibility(state.squaresX, state.squaresY, pd.wMm, pd.hMm).steps[0]?.pages;
        hint =
            fewestAnyDistance !== undefined && fewestAnyDistance < count
                ? interpolate(S.pagesFewestHint, {
                      distance: distanceLabel(state.distanceId, imperial),
                      mm: workingDistanceMinSquareMm(state.distanceId),
                  })
                : interpolate(S.pagesFewestGridHint, {sheets: sheetsShort(printedSheetCount(count))});
    } else if (tiling && !more) {
        // The last stop is always one square per sheet (checked by scripts/check-presets.ts).
        hint = S.pagesMostOnePerSheetHint;
    }
    const hintEl = byId('pagesHint');
    hintEl.textContent = hint;
    hintEl.classList.toggle('hidden', hint === '');
}

/** Click steps once; holding repeats (after 400 ms, every 120 ms) until an end stop. */
function wirePageStepButton(btn: HTMLElement, which: 'fewer' | 'more'): void {
    const readout = byId('pagesValue');
    let delayTimer: number | undefined;
    let repeatTimer: number | undefined;
    let repeated = false;
    const stop = (): void => {
        window.clearTimeout(delayTimer);
        window.clearInterval(repeatTimer);
        delayTimer = undefined;
        repeatTimer = undefined;
        if (readout.getAttribute('aria-live') === 'off') {
            // Announce only where the hold ended, not every step on the way.
            readout.setAttribute('aria-live', 'polite');
            const text = readout.textContent;
            readout.textContent = '';
            requestAnimationFrame(() => {
                readout.textContent = text;
            });
        }
    };
    btn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) {
            return;
        }
        stop();
        repeated = false;
        btn.setPointerCapture(e.pointerId);
        delayTimer = window.setTimeout(() => {
            readout.setAttribute('aria-live', 'off');
            repeatTimer = window.setInterval(() => {
                repeated = true;
                // Keeps the preview on the short interactive debounce while repeating (cleared on window pointerup).
                rangePointerHeld = true;
                if (!stepPages(which)) {
                    stop();
                }
            }, 120);
        }, 400);
    });
    btn.addEventListener('pointerup', stop);
    // Not lostpointercapture: a normal release fires it before its click, which must still be swallowed.
    for (const type of ['pointercancel', 'blur']) {
        btn.addEventListener(type, () => {
            stop();
            // No click follows a cancelled hold, so nothing is left to swallow.
            repeated = false;
        });
    }
    // A long press must repeat, not open the context menu or start a text selection.
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
        // The click that ends a hold must not step again; keyboard clicks (detail 0) always step.
        if (repeated && e.detail !== 0) {
            repeated = false;
            return;
        }
        repeated = false;
        stepPages(which);
    });
}

/**
 * Square length is the distance slider: the distance drop-down only presets it, so when the square moves
 * into another band the drop-down follows instead of blocking it.
 */
function setSquareFollowingBand(squareMm: number): void {
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
function setGridSize(axis: 'squaresX' | 'squaresY', requested: number): void {
    const other = axis === 'squaresX' ? state.squaresY : state.squaresX;
    let max = boardGridAxisMax(other);
    if (state.mode === 'shop' && state.shopSizeId) {
        // Print shop: one board, so X / Y also stop where the board would outgrow the chosen size.
        max = Math.min(max, maxShopGridForSquare(axis, other, state.squareMm, state.shopSizeId) ?? BOARD_GRID_MIN);
    }
    state[axis] = clampInt(requested, BOARD_GRID_MIN, max);
}

function syncThemeToggle(): void {
    const group = byId('themeToggle');
    group.setAttribute('aria-label', S.colorTheme);
    const pref = getStoredPreference();
    for (const b of group.querySelectorAll<HTMLButtonElement>('[data-theme-pick]')) {
        const pick = b.dataset.themePick as ThemePreference;
        const label = pick === 'dark' ? S.themeDark : pick === 'light' ? S.themeLight : S.themeSystem;
        b.setAttribute('aria-label', label);
        b.setAttribute('title', label);
        b.setAttribute('aria-pressed', String(pick === pref));
    }
}

function showErr(msg: string | null): void {
    const el = byId('errBanner');
    if (msg) {
        el.classList.remove('hidden');
        el.textContent = msg;
    } else {
        el.classList.add('hidden');
        el.textContent = '';
    }
}

/** The chart to scale in front of two people; mounted in {@link boot}. */
let scaleScene: ReturnType<typeof mountScaleScene> | null = null;

let previewTimer: ReturnType<typeof setTimeout> | null = null;
/** The running preview's; a new run aborts it, so a stale run sees its signal aborted. */
let previewAbort: AbortController | null = null;
/** Set while a PDF export runs; the Save button then cancels it instead of starting another. */
let pdfExportAbort: AbortController | null = null;

let syncUiRafId: number | null = null;
/** Cached so we don't rebuild selects on every drag frame (expensive and blocks paint). */
let syncedDistanceSelectKey = '';
let syncedPaperSelectKey = '';
/** True while `#distance` native selection was cleared so re-picking the same option fires `change`; must not overwrite value in `syncUi`. */
let suppressDistanceSelectUiClamp = false;
/** Square-length band labels + gradient only depend on locale (imperial vs m) and tier constants. */
let syncedTierBandKey = '';
/** While true, previews use a shorter debounce; range `pointerdown`/`pointerup` maintain this. */
let rangePointerHeld = false;

type SyncUiOptions = {
    /**
     * When true, skips static chrome (titles, intros, unmoving labels) so slider drags do less DOM work per frame.
     */
    lite?: boolean;
    /**
     * When set, overrides automatic interactive vs idle debounce for the preview scheduling at the end of this sync.
     */
    previewDelayMs?: number;
};

/**
 * Batches slider-driven DOM updates into the next animation frame so the UI thread can paint spinners,
 * repaint the active range input, and run CSS animations instead of starving on hundreds of syncUi calls.
 */
function scheduleSyncUi(): void {
    if (syncUiRafId !== null) {
        return;
    }
    syncUiRafId = window.requestAnimationFrame(() => {
        syncUiRafId = null;
        syncUi({lite: true});
    });
}

/** Ends a slider drag or a held stepper: one full sync (it drops any pending lite one) and the preview now. */
function finalizeRangeGesture(): void {
    if (!rangePointerHeld) {
        return;
    }
    rangePointerHeld = false;
    syncUi({lite: false, previewDelayMs: 0});
}

function setIntroElement(el: HTMLElement): void {
    const prefix = document.createTextNode(S.introMain + S.introDocsPrefix);
    const a = document.createElement('a');
    a.href = FREEMOCAP_CALIBRATION_DOCS_MULTI_CAM_URL;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = S.introDocsLinkLabel;
    const suffix = document.createTextNode(S.introDocsSuffix);
    el.replaceChildren(prefix, a, suffix);
}

function setPrintAdviceElement(el: HTMLElement): void {
    if (state.mode === 'shop') {
        const finish = document.createElement('p');
        const lead = document.createElement('strong');
        lead.textContent = S.shopAdviceLead;
        finish.append(lead, document.createTextNode(S.shopAdviceFinish));
        const paragraphs: string[] = [S.shopAdviceSubstrate, S.shopAdviceProducts, S.shopAdviceTemplate];
        if (!state.shopCropMarks) {
            paragraphs.push(S.shopAdviceCropMarks);
        }
        el.replaceChildren(
            finish,
            ...paragraphs.map((text) => {
                const p = document.createElement('p');
                p.textContent = text;
                return p;
            }),
        );
        return;
    }
    const shop = document.createElement('p');
    const shopLead = document.createElement('strong');
    shopLead.textContent = S.printAdviceShopLead;
    shop.append(shopLead, document.createTextNode(S.printAdviceShop));
    const home = document.createElement('p');
    home.textContent = S.printAdviceHomeBody;
    const homeRule = document.createElement('p');
    const emphasis = document.createElement('strong');
    emphasis.textContent = S.printAdviceHomeEmphasis;
    homeRule.appendChild(emphasis);
    el.replaceChildren(shop, home, homeRule);
}

/** Keeps the address bar's packed chart query (`b`) in step with the QR / exported chart; drops legacy keys. */
function syncAddressBarChartQuery(): void {
    const {squaresX, squaresY} = state;
    const u = new URL(buildCharucoDocumentationUrl(window.location.href, squaresX, squaresY, state.squareMm, linkTarget()));
    const next = `${u.pathname}${u.search}${u.hash}`;
    const cur = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next === cur) {
        return;
    }
    try {
        window.history.replaceState(history.state, '', next);
    } catch {
        // Rate-limited (WebKit throws past 100 calls in 30 s); the next change writes it again.
    }
}

let addressBarTimer: number | null = null;

/** Trailing debounce for {@link syncAddressBarChartQuery}, so a slider drag does not rewrite the URL every frame. */
function scheduleAddressBarSync(): void {
    if (addressBarTimer !== null) {
        window.clearTimeout(addressBarTimer);
    }
    addressBarTimer = window.setTimeout(() => {
        addressBarTimer = null;
        syncAddressBarChartQuery();
    }, PREVIEW_DEBOUNCE_IDLE_MS);
}

/** Advanced settings fold out on narrow screens only; on desktop they stay open (see style.css). */
function initAdvancedFoldout(): void {
    const advanced = document.getElementById('advancedSettings') as HTMLDetailsElement | null;
    if (!advanced) {
        return;
    }
    const desktop = window.matchMedia('(min-width: 1024px)');
    const sync = (): void => {
        if (desktop.matches) {
            advanced.open = true;
        }
    };
    sync();
    desktop.addEventListener('change', sync);
    // Desktop has no toggle, so keep it from being closed by any route.
    advanced.addEventListener('toggle', sync);
}

/**
 * Dev-only control: choose whether QR links target production or this dev server. The encoded
 * URL is shown as a link so query-parameter round-tripping can be tested without a phone.
 * Not created at all in release builds.
 */
function initDevQrLinkTargetUi(): void {
    if (!isQrLinkTargetSwitchAvailable()) {
        return;
    }
    const advanced = document.getElementById('advancedSettings');
    if (!advanced) {
        return;
    }

    const field = document.createElement('fieldset');
    field.className = 'qr-link-target-field';

    const legend = document.createElement('legend');
    legend.textContent = 'QR link target (dev only)';

    const options = document.createElement('div');
    options.className = 'qr-link-target-options';
    for (const [value, text] of [
        ['production', 'Production (skelly.cam)'],
        ['local', 'Local dev server (LAN)'],
    ] as const) {
        const row = document.createElement('div');
        row.className = 'qr-link-target-option-row';

        const label = document.createElement('label');
        label.className = 'qr-link-target-option';

        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'qrLinkTarget';
        input.value = value;
        input.checked = getQrLinkTarget() === value;
        input.addEventListener('change', () => {
            if (!input.checked) {
                return;
            }
            setQrLinkTarget(value);
            syncUi({previewDelayMs: 0});
        });

        const link = document.createElement('a');
        link.className = 'caption qr-link-url';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = 'Open this URL to test QR query parsing';
        link.dataset.qrTarget = value;

        label.append(input, document.createTextNode(text));
        row.append(label, link);
        options.appendChild(row);
    }

    field.append(legend, options);
    advanced.insertAdjacentElement('afterend', field);
}

/** Keeps the dev-only QR target radios and both candidate URLs in sync with the current chart. */
function syncDevQrLinkTargetUi(): void {
    const inputs = document.querySelectorAll<HTMLInputElement>(
        '.qr-link-target-field input[name="qrLinkTarget"]',
    );
    const links = document.querySelectorAll<HTMLAnchorElement>(
        '.qr-link-target-field a.qr-link-url',
    );
    if (inputs.length === 0 || links.length === 0) {
        return;
    }
    const target = getQrLinkTarget();
    for (const input of inputs) {
        input.checked = input.value === target;
    }
    const {squaresX, squaresY} = state;
    for (const link of links) {
        const qrTarget = link.dataset.qrTarget === 'local' ? 'local' : 'production';
        const url = buildCharucoDocumentationUrl(
            resolveQrLinkSourceUrlFor(qrTarget),
            squaresX,
            squaresY,
            state.squareMm,
            linkTarget(),
        );
        link.href = url;
        link.textContent = url;
    }
}

function syncUi(options: SyncUiOptions = {}): void {
    const {lite = false, previewDelayMs} = options;
    const t0 = IS_DEV ? performance.now() : 0;
    if (syncUiRafId !== null) {
        window.cancelAnimationFrame(syncUiRafId);
        syncUiRafId = null;
    }
    applyAutoPreset();
    const imperial = prefersImperialUnits();
    const tiling = effectiveTiling();

    if (!lite) {
        byId('pageTitle').textContent = S.title;
        setIntroElement(byId('intro'));
        byId('lbl-distance').textContent = S.workingDistance;
        byId('lbl-paper').textContent = S.paperSize;
        byId('lbl-advanced').textContent = S.advanced;
    }
    syncModeControls();
    byId('lbl-square').textContent = interpolate(S.squareLengthHeading, {mm: state.squareMm});
    byId('lbl-sx').textContent = interpolate(S.squaresInX, {n: state.squaresX});
    byId('lbl-sy').textContent = interpolate(S.squaresInY, {n: state.squaresY});
    if (!lite) {
        byId('print-save-heading').textContent = S.printSave;
        byId('preview-title').textContent = S.previewTitle;
        byId('fullChartHint').textContent = S.fullChartHint;
        setPrintAdviceElement(byId('printAdvice'));
    }

    const frac = squareLengthTierBandEdgeFractions(squareSliderMaxMm());
    const pCloseEnd = frac.closeNear * 100;
    const pNearEnd = frac.nearFar * 100;
    const tierBandKey = `${imperial}:${pCloseEnd}:${pNearEnd}`;
    const sliderStack = byId('squareMmSliderStack') as HTMLDivElement;
    if (tierBandKey !== syncedTierBandKey) {
        syncedTierBandKey = tierBandKey;
        const tierEl = byId('tierLabels');
        tierEl.innerHTML = '';
        const s1 = document.createElement('span');
        s1.style.width = `${pCloseEnd}%`;
        s1.style.color = 'var(--close)';
        s1.textContent = distanceLabel('close', imperial);
        const s2 = document.createElement('span');
        s2.style.width = `${Math.max(0, pNearEnd - pCloseEnd)}%`;
        s2.style.color = 'var(--near)';
        s2.textContent = distanceLabel('near', imperial);
        const s3 = document.createElement('span');
        s3.style.flex = '1';
        s3.style.color = 'var(--far)';
        s3.textContent = distanceLabel('far', imperial);
        tierEl.append(s1, s2, s3);
        sliderStack.style.setProperty('--tier-p-close-end', `${pCloseEnd}%`);
        sliderStack.style.setProperty('--tier-p-near-end', `${pNearEnd}%`);
    }

    const sqmm = byId('sqmm') as HTMLInputElement;
    sqmm.min = String(CHARUCO_SQUARE_MM_MIN);
    sqmm.max = String(squareSliderMaxMm());
    sqmm.step = '1';
    sqmm.value = String(state.squareMm);

    syncPageStepper(tiling, imperial);

    const sx = byId('sx') as HTMLInputElement;
    const sy = byId('sy') as HTMLInputElement;
    sx.min = String(BOARD_GRID_MIN);
    sx.max = String(BOARD_GRID_MAX);
    sy.min = String(BOARD_GRID_MIN);
    sy.max = String(BOARD_GRID_MAX);
    sx.step = '1';
    sy.step = '1';
    sx.value = String(state.squaresX);
    sy.value = String(state.squaresY);

    const distSel = byId('distance') as HTMLSelectElement;
    const distanceSelectKey = `${imperial}:${WORKING_DISTANCES.map((d) => d.id).join('|')}`;
    if (distanceSelectKey !== syncedDistanceSelectKey) {
        syncedDistanceSelectKey = distanceSelectKey;
        distSel.innerHTML = '';
        for (const {id} of WORKING_DISTANCES) {
            const o = document.createElement('option');
            o.value = id;
            o.textContent = distanceSelectLabel(id, imperial);
            distSel.appendChild(o);
        }
    }
    if (!suppressDistanceSelectUiClamp) {
        distSel.value = state.distanceId;
    }

    const paperSel = byId('paper') as HTMLSelectElement;
    const paperSelectKey = PAPERS.map((p) => p.id).join('|');
    if (paperSelectKey !== syncedPaperSelectKey) {
        syncedPaperSelectKey = paperSelectKey;
        paperSel.innerHTML = '';
        for (const p of PAPERS) {
            const o = document.createElement('option');
            o.value = p.id;
            o.textContent = interpolate(S.paperOption, {
                paper: paperLabel(p.id),
                dims: paperOptionDimensions(p),
            });
            paperSel.appendChild(o);
        }
    }
    paperSel.value = state.paperId;

    const shopLayout = shopLayoutNow();
    const summary = state.mode === 'shop' ? shopSummaryText(shopLayout) : layoutSummaryText(
        tiling,
        state.squaresX,
        state.squaresY,
        state.squareMm,
        (n) => sheetCountPhrase(printedSheetCount(n)),
        (cols, rows) => interpolate('; {{cols}}×{{rows}} sheet grid + assembly guide', {cols, rows}),
        (squaresX, squaresY, squareMm) =>
            interpolate('; {{squaresX}}×{{squaresY}} squares; {{squareMm}} mm square length', {
                squaresX,
                squaresY,
                squareMm,
            }),
        S.layoutCannotFit,
    );
    byId('layoutSummary').textContent = summary;

    syncExportButtons();

    if (!lite) {
        syncThemeToggle();
        showErr(null);
    }
    if (IS_DEV) {
        const dt = performance.now() - t0;
        if (dt > 16) {
            perfLog(
                'syncUi (before schedulePreview debounce)',
                dt,
                lite ? 'lite: sliders → reduced DOM refresh' : 'full: distance/paper / range release → DOM refresh',
            );
        }
    }
    syncDevQrLinkTargetUi();
    schedulePreview(previewDelayMs);
    scheduleAddressBarSync();
}

/** Whether {@link runBusy} has a job running on `btn`. */
function isBusy(btn: HTMLButtonElement): boolean {
    return btn.dataset.busy !== undefined;
}

/**
 * Print and Save are enabled when there is something to print. A busy button keeps its job's label; busy
 * Print stays disabled, while busy Save stays enabled because clicking it cancels the export.
 */
function syncExportButtons(): void {
    const btnPdf = byId('btnPdf') as HTMLButtonElement;
    const btnSavePdf = byId('btnSavePdf') as HTMLButtonElement;
    const exportDisabled = !hasPrintableLayout();
    btnPdf.disabled = exportDisabled || isBusy(btnPdf);
    btnSavePdf.disabled = exportDisabled && !isBusy(btnSavePdf);
    // Print shop: the PDF is the deliverable, so Print goes and the download becomes the main action.
    const shop = state.mode === 'shop';
    btnPdf.classList.toggle('hidden', shop);
    btnSavePdf.classList.toggle('btn-primary', shop);
    btnSavePdf.classList.toggle('btn-secondary', !shop);
    if (!isBusy(btnPdf)) {
        btnPdf.textContent = S.printCharts;
    }
    if (!isBusy(btnSavePdf)) {
        btnSavePdf.textContent = shop ? S.shopDownload : S.savePdfFiles;
    }
}

/** Mode toggle, which board-size control shows, and the print-shop size, unit, bleed and crop-mark controls. */
function syncModeControls(): void {
    const shop = state.mode === 'shop';
    byId('lbl-mode').textContent = S.printWith;
    for (const btn of byId('modeToggle').querySelectorAll<HTMLButtonElement>('[data-mode]')) {
        btn.textContent = btn.dataset.mode === 'shop' ? S.modeShop : S.modeHome;
        btn.setAttribute('aria-pressed', String(btn.dataset.mode === state.mode));
    }
    const notice = byId('modeNotice');
    notice.textContent = modeNotice ?? '';
    notice.classList.toggle('hidden', modeNotice === null);

    byId('paperField').classList.toggle('hidden', shop);
    byId('pagesGroup').classList.toggle('hidden', shop);
    for (const id of ['shopSizeField', 'shopBleedField', 'shopCropField', 'shopOrder']) {
        byId(id).classList.toggle('hidden', !shop);
    }
    if (!shop) {
        return;
    }

    byId('lbl-shopSize').textContent = S.shopSize;
    const unitToggle = byId('shopUnitToggle');
    unitToggle.setAttribute('aria-label', S.shopUnits);
    for (const btn of unitToggle.querySelectorAll<HTMLButtonElement>('[data-unit]')) {
        btn.setAttribute('aria-pressed', String(btn.dataset.unit === state.shopUnit));
    }

    // Sizes this grid cannot fit at any square length are listed but disabled.
    const sizeSel = byId('shopSize') as HTMLSelectElement;
    const sizeKey = `${state.shopUnit}|${state.squaresX}x${state.squaresY}`;
    if (sizeSel.dataset.key !== sizeKey) {
        sizeSel.dataset.key = sizeKey;
        sizeSel.innerHTML = '';
        for (const group of shopSizeGroups(state.shopUnit)) {
            const og = document.createElement('optgroup');
            og.label = group.unit === 'in' ? S.shopSizeGroupIn : S.shopSizeGroupMm;
            for (const size of group.sizes) {
                const o = document.createElement('option');
                o.value = size.id;
                const label = shopSizeOptionLabel(size, state.shopUnit);
                const fits = maxShopSquareMm(state.squaresX, state.squaresY, size.id) !== null;
                o.textContent = fits ? label : interpolate(S.shopSizeTooSmall, {size: label});
                o.disabled = !fits;
                og.appendChild(o);
            }
            sizeSel.appendChild(og);
        }
    }
    sizeSel.value = state.shopSizeId ?? '';

    const layout = shopLayoutNow();
    const imperial = state.shopUnit === 'in';
    byId('shopSizeDetail').textContent = layout
        ? interpolate(S.shopSizeDetail, {trim: formatShopTrim(layout.trimWMm, layout.trimHMm, state.shopUnit), ...chartSizeParts(imperial)})
        : '';
    // The largest sizes are the walk-in cap: say why there is nothing bigger.
    const atCap = state.shopSizeId === '36x48in' || state.shopSizeId === '900x1200mm';
    const hint = [shopSizeHint, atCap ? S.shopCapNote : null].filter((h) => h !== null).join(' ');
    const hintEl = byId('shopSizeHint');
    hintEl.textContent = hint;
    hintEl.classList.toggle('hidden', hint === '');

    byId('lbl-shopBleed').textContent = S.shopBleed;
    const bleedSel = byId('shopBleed') as HTMLSelectElement;
    const choices = shopBleedChoices(state.shopUnit);
    const current = state.shopBleed === 'std' ? 'std' : String(state.shopBleed.mm);
    const values = choices.map((c) => (c === 'std' ? 'std' : String(c.mm)));
    const bleedKey = `${state.shopUnit}|${values.includes(current) ? '' : current}`;
    if (bleedSel.dataset.key !== bleedKey) {
        bleedSel.dataset.key = bleedKey;
        bleedSel.innerHTML = '';
        const otherUnit = state.shopUnit === 'in' ? 'mm' : 'in';
        const labels = [
            interpolate(S.shopBleedStd, {bleed: formatShopBleed(shopStandardBleedMm(state.shopUnit))}),
            S.shopBleedNone,
            S.shopBleed5,
            S.shopBleed10,
            S.shopBleedQuarter,
            interpolate(S.shopBleedOther, {bleed: formatShopBleed(shopStandardBleedMm(otherUnit)), unit: otherUnit}),
        ];
        values.forEach((value, i) => bleedSel.add(new Option(labels[i], value)));
        if (!values.includes(current)) {
            // A link may carry any bleed up to 25 mm; show it rather than silently change it.
            bleedSel.add(new Option(formatShopBleed(Number(current)), current));
        }
    }
    bleedSel.value = current;

    const pageEl = byId('shopPageSize');
    if (layout) {
        const bleedMm = bleedMmForUnit(state.shopBleed, state.shopUnit);
        const page = pageSizeMm({wMm: layout.trimWMm, hMm: layout.trimHMm}, bleedMm, state.shopCropMarks);
        const pageDims = formatShopDims(page.wMm, page.hMm, state.shopUnit);
        const trimDims = formatShopDims(layout.trimWMm, layout.trimHMm, state.shopUnit).replace(/ (mm|in)$/, '');
        const extras = [
            bleedMm > 0 ? interpolate(S.shopPageBleed, {bleed: formatShopBleed(bleedMm)}) : null,
            state.shopCropMarks ? S.shopPageMarks : null,
        ].filter((e) => e !== null);
        pageEl.textContent = extras.length
            ? interpolate(S.shopPageSize, {page: pageDims, trim: trimDims, extras: extras.join(' + ')})
            : interpolate(S.shopPageSizeExact, {page: pageDims});
    } else {
        pageEl.textContent = '';
    }
    byId('lbl-shopCropMarks').textContent = S.shopCropMarks;
    (byId('shopCropMarks') as HTMLInputElement).checked = state.shopCropMarks;

    byId('shopOrderTitle').textContent = S.shopOrderTitle;
    byId('btnCopyOrder').textContent = S.shopOrderCopy;
    const orderText = layout ? shopOrderText(layout) : '';
    const orderEl = byId('shopOrderText');
    if (orderEl.textContent !== orderText) {
        orderEl.textContent = orderText;
        byId('copyOrderStatus').textContent = '';
    }
}

/**
 * The note for the shop: print at 100%, the file and trim size, the board, colour handling and how to check
 * the squares on delivery. It carries the same facts as the slug and the PDF subject.
 */
function shopOrderText(layout: NonNullable<ReturnType<typeof shopLayoutNow>>): string {
    const unit = state.shopUnit;
    const bleedMm = bleedMmForUnit(state.shopBleed, unit);
    const trim = formatShopTrim(layout.trimWMm, layout.trimHMm, unit);
    const page = pageSizeMm({wMm: layout.trimWMm, hMm: layout.trimHMm}, bleedMm, state.shopCropMarks);
    const pageDims = formatShopDims(page.wMm, page.hMm, unit);
    const bleed = formatShopBleed(bleedMm);
    let pageLine: string;
    if (state.shopCropMarks) {
        const included = bleedMm > 0 ? interpolate(S.shopOrderBleedIncluded, {bleed}) : S.shopOrderNoBleed;
        pageLine = interpolate(S.shopOrderPageMarks, {page: pageDims, trim, bleed: included});
    } else {
        pageLine = bleedMm > 0 ? interpolate(S.shopOrderPage, {page: pageDims, trim, bleed}) : interpolate(S.shopOrderPageExact, {trim});
    }
    // 5 mm foam flexes past 24 × 36 in, so bigger boards need a stiffer substrate.
    const large = Math.max(layout.trimWMm, layout.trimHMm) > 914.4 + 1e-6;
    const n = Math.max(2, Math.min(state.squaresX, Math.floor(300 / state.squareMm)));
    const lines = [
        interpolate(S.shopOrderChart, {squaresX: state.squaresX, squaresY: state.squaresY, mm: state.squareMm}),
        S.shopOrderScale,
        pageLine,
        large ? S.shopOrderBoardLarge : S.shopOrderBoardSmall,
        S.shopOrderColour,
        interpolate(S.shopOrderCheck, {n, total: n * state.squareMm, mm: state.squareMm}),
    ];
    // Near the walk-in cap, say why the board cannot be bigger.
    const e = shopQuietZoneMm(state.squareMm);
    const needW = layout.content.w + 2 * e;
    const needH = layout.content.h + 2 * e;
    if (Math.min(needW, needH) >= SHOP_TRIM_MAX_MM[0] - 25 || Math.max(needW, needH) >= SHOP_TRIM_MAX_MM[1] - 25) {
        lines.push(S.shopCapNote);
    }
    return lines.join('\n');
}

async function copyShopOrder(): Promise<void> {
    const text = byId('shopOrderText').textContent ?? '';
    const status = byId('copyOrderStatus');
    try {
        await navigator.clipboard.writeText(text);
        status.textContent = S.shopOrderCopied;
    } catch {
        // No clipboard access (permissions, insecure context): select the note so it can be copied by hand.
        const range = document.createRange();
        range.selectNodeContents(byId('shopOrderText'));
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        status.textContent = S.shopOrderCopyManual;
    }
}

/** The chart a scanned QR code described; the scan card shows once per tab. */
let scannedChart: {squaresX: number; squaresY: number; squareMm: number; shop: boolean} | null = null;

function renderScanCard(): void {
    const card = byId('scanCard');
    if (!scannedChart) {
        card.classList.add('hidden');
        card.replaceChildren();
        return;
    }
    const p = (text: string, className?: string): HTMLParagraphElement => {
        const el = document.createElement('p');
        el.textContent = text;
        if (className) {
            el.className = className;
        }
        return el;
    };
    const title = p(
        interpolate(S.scanCardTitle, {squaresX: scannedChart.squaresX, squaresY: scannedChart.squaresY, mm: scannedChart.squareMm}),
        'scan-card-title',
    );
    title.id = 'scanCardTitle';
    const docs = document.createElement('p');
    const a = document.createElement('a');
    a.href = FREEMOCAP_CALIBRATION_DOCS_MULTI_CAM_URL;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = S.scanCardDocs;
    docs.appendChild(a);
    const button = (label: string, className: string, onClick: () => void): HTMLButtonElement => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = className;
        b.textContent = label;
        b.addEventListener('click', onClick);
        return b;
    };
    const close = (): void => {
        scannedChart = null;
        renderScanCard();
    };
    const actions = document.createElement('div');
    actions.className = 'scan-card-actions';
    actions.append(
        button(S.scanCardPrintAnother, 'btn btn-secondary', () => {
            close();
            setMode('home');
        }),
        button(S.scanCardOrder, 'btn btn-secondary', () => {
            close();
            setMode('shop');
        }),
    );
    const dismiss = button('×', 'scan-card-dismiss', close);
    dismiss.setAttribute('aria-label', S.scanCardDismiss);
    card.replaceChildren(
        title,
        p(S.scanCardMeasure),
        ...(scannedChart.shop ? [p(S.scanCardFlat)] : []),
        docs,
        actions,
        dismiss,
    );
    card.classList.remove('hidden');
}

/** Print-shop summary: one board, its trim (toggled unit first), orientation, grid and square length. */
function shopSummaryText(layout: ReturnType<typeof shopLayoutNow>): string {
    if (!layout) {
        return S.layoutCannotFit;
    }
    return interpolate(S.shopSummary, {
        trim: formatShopTrim(layout.trimWMm, layout.trimHMm, state.shopUnit),
        orientation: layout.landscape ? S.landscape : S.portrait,
        squaresX: state.squaresX,
        squaresY: state.squaresY,
        mm: state.squareMm,
    });
}

function schedulePreview(delayOverride?: number): void {
    if (previewTimer) {
        clearTimeout(previewTimer);
    }
    const scheduleBaselineMs = IS_DEV ? performance.now() : undefined;
    const delayMs =
        delayOverride !== undefined
            ? delayOverride
            : rangePointerHeld
              ? PREVIEW_DEBOUNCE_INTERACTIVE_MS
              : PREVIEW_DEBOUNCE_IDLE_MS;
    previewTimer = setTimeout(() => {
        previewTimer = null;
        void runPreview(scheduleBaselineMs, delayMs);
    }, delayMs);
}

function waitAnimationFrames(count: number): Promise<void> {
    if (count <= 0) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const step = (left: number): void => {
            if (left <= 0) {
                resolve();
                return;
            }
            requestAnimationFrame(() => step(left - 1));
        };
        step(count);
    });
}

/**
 * After assigning SVG data URLs to `<img>`, the slow part is often **paint/composite**, which
 * happens *after* `decode()` resolves. We still `decode()` (readiness), then wait
 * **2× requestAnimationFrame** as a rough proxy for “about to paint”.
 */
async function awaitPreviewImagesDecodedAndPaint(thumbsRoot: HTMLElement): Promise<void> {
    const tDecode = IS_DEV ? performance.now() : 0;
    const pending: Promise<void>[] = Array.from(thumbsRoot.querySelectorAll<HTMLImageElement>('img.thumb-img'), (im) =>
        im.decode().catch(() => {}),
    );
    await Promise.all(pending);
    if (IS_DEV) {
        perfLog('browser <img> decode()', performance.now() - tDecode, `${pending.length} images`);
    }

    const tRaf = IS_DEV ? performance.now() : 0;
    await waitAnimationFrames(2);
    if (IS_DEV) {
        perfLog('2× requestAnimationFrame after decode (paint proxy)', performance.now() - tRaf);
    }
}

/** One preview thumbnail: the sheet image, under its caption when it has one. */
function thumb(caption: string | null, src: string, alt: string, border?: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'thumb-wrap';
    if (caption !== null) {
        const cap = document.createElement('p');
        cap.className = 'cap';
        cap.textContent = caption;
        wrap.appendChild(cap);
    }
    const img = document.createElement('img');
    img.className = 'thumb-img';
    img.src = src;
    img.alt = alt;
    if (border) {
        img.style.border = border;
    }
    wrap.appendChild(img);
    return wrap;
}

async function runPreview(scheduleBaselineMs?: number, scheduledDelayMs?: number): Promise<void> {
    previewAbort?.abort();
    previewAbort = new AbortController();
    const signal = previewAbort.signal;

    const statusEl = byId('previewStatus') as HTMLParagraphElement;
    const panelPreview = byId('panelPreview');

    if (state.mode === 'shop') {
        await runShopPreview(signal);
        if (!signal.aborted) {
            panelPreview.setAttribute('aria-busy', 'false');
        }
        return;
    }

    const chart = snapshotChart();
    if (!chart) {
        statusEl.textContent = '';
        panelPreview.setAttribute('aria-busy', 'false');
        clearPreview();
        return;
    }
    const {tiling} = chart;
    const multi = tiling.pageCount > 1;
    const thumbs = byId('thumbGrid');
    const trunc = byId('previewTruncated');

    panelPreview.setAttribute('aria-busy', 'true');
    statusEl.textContent = '';
    // Assembly instructions only make sense when the chart spans several sheets.
    byId('fullChartHint').classList.toggle('hidden', !multi);
    setThumbGridPlaceholder(S.loadingPreviews);
    await yieldToMain();

    try {
        const previewWallStart = IS_DEV ? performance.now() : 0;

        // Only the thumbnails that are shown are rendered; sheet headers still count every chart sheet.
        const printResult = await renderCharucoPrintSvg(chart, {
            maxSheets: MAX_PREVIEW_PAGES,
            betweenSheets: () => yieldToMainUnlessAborted(signal),
        });
        if (signal.aborted) {
            return;
        }

        const tThumbs = IS_DEV ? performance.now() : 0;
        const pageImages = printResult.sheets.map((svg) => svgToDataUrl(svg));
        if (IS_DEV) {
            perfLog(
                'preview thumbs (svgToDataUrl × N)',
                performance.now() - tThumbs,
                `${pageImages.length} thumbs — each encodes full sheet SVG`,
            );
        }
        // A single sheet is shown as printed; several as the assembled chart with its sheet numbers.
        scaleScene?.update(
            multi
                ? {
                      svg: svgAssembledChartWithSheetNumbers(chart),
                      widthMm: chart.squaresX * chart.squareMm,
                      heightMm: chart.squaresY * chart.squareMm,
                      isSheet: false,
                  }
                : {svg: printResult.sheets[0]!, widthMm: tiling.paperWMm, heightMm: tiling.paperHMm, isSheet: true},
        );

        const truncated = tiling.pageCount > MAX_PREVIEW_PAGES;
        trunc.classList.toggle('hidden', !truncated);
        if (truncated) {
            // Counts printed sheets, like the sheets stepper: the guide thumbnail is one of them.
            trunc.textContent = interpolate(S.truncatedPreview, {
                shown: pageImages.length + (multi ? 1 : 0),
                total: printedSheetCount(tiling.pageCount),
            });
        }
        thumbs.innerHTML = '';
        if (printResult.guide) {
            // The assembly guide prints first and is unnumbered.
            thumbs.appendChild(thumb(S.assemblyGuideLabel, svgToDataUrl(printResult.guide), S.assemblyGuideLabel));
        }
        pageImages.forEach((src, i) => {
            const label = interpolate(S.pageLabel, {n: i + 1});
            // A single sheet is the whole chart, so it has no page caption. Several share the full-chart
            // blocks' palette, so each thumbnail matches its block's colour.
            thumbs.appendChild(
                multi
                    ? thumb(label, src, label, `2px solid ${rgbCss(sheetColorRgb(i + 1, tiling.pageCount))}`)
                    : thumb(null, src, label),
            );
        });
        await awaitPreviewImagesDecodedAndPaint(thumbs);
        if (signal.aborted) {
            return;
        }
        if (IS_DEV) {
            perfLog('runPreview JS through paint proxy', performance.now() - previewWallStart, '');
            if (scheduleBaselineMs !== undefined) {
                perfLog(
                    'wall: schedulePreview → paint proxy',
                    performance.now() - scheduleBaselineMs,
                    `debounce target ${scheduledDelayMs}ms`,
                );
            }
        }
        statusEl.textContent = '';
    } catch (e) {
        if ((e as Error).name === 'AbortError') {
            return;
        }
        statusEl.textContent = e instanceof Error ? e.message : String(e);
        clearPreview();
    } finally {
        if (!signal.aborted) {
            panelPreview.setAttribute('aria-busy', 'false');
        }
    }
}

/** Print-shop preview: the one board, exactly the SVG the PDF is made from (page, bleed, marks and slug). */
async function runShopPreview(signal: AbortSignal): Promise<void> {
    const statusEl = byId('previewStatus') as HTMLParagraphElement;
    const panelPreview = byId('panelPreview');
    const thumbs = byId('thumbGrid');
    byId('fullChartHint').classList.add('hidden');
    byId('previewTruncated').classList.add('hidden');
    const layout = shopLayoutNow();
    if (!layout || !state.shopSizeId) {
        statusEl.textContent = '';
        clearPreview();
        return;
    }
    // Snapshot the board before yielding, as the home preview does, so a control change cannot mix two.
    const board = {squaresX: state.squaresX, squaresY: state.squaresY, squareMm: state.squareMm};
    const size = {id: state.shopSizeId, unit: state.shopUnit};
    const options = shopOptions();
    const alt = shopSummaryText(layout);
    panelPreview.setAttribute('aria-busy', 'true');
    statusEl.textContent = '';
    setThumbGridPlaceholder(S.loadingPreviews);
    await yieldToMain();
    try {
        const {renderShopPrintSvg} = await import('./print/shopSheet.js');
        const sheet = await renderShopPrintSvg({...board, layout, size, options});
        if (signal.aborted) {
            return;
        }
        const sheetImage = svgToDataUrl(sheet.svg);
        // The scale scene shows the board as trimmed: the page cropped to its trim box.
        const ppm = PIXELS_PER_MM;
        const t = sheet.trimBoxMm;
        const trimmed =
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${t.x * ppm} ${t.y * ppm} ${t.w * ppm} ${t.h * ppm}">` +
            `<image href="${sheetImage}" width="${sheet.mediaMm.w * ppm}" height="${sheet.mediaMm.h * ppm}"/></svg>`;
        scaleScene?.update({svg: trimmed, widthMm: t.w, heightMm: t.h, isSheet: true});
        thumbs.innerHTML = '';
        thumbs.appendChild(thumb(null, sheetImage, alt));
        await awaitPreviewImagesDecodedAndPaint(thumbs);
    } catch (e) {
        if (!signal.aborted) {
            statusEl.textContent = e instanceof Error ? e.message : String(e);
            clearPreview();
        }
    }
}

function stripXmlDeclaration(svg: string): string {
    return svg.replace(/^\s*<\?xml[\s\S]*?\?>\s*/i, '').trimStart();
}

/** Trigger a file download from blob contents. */
function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Give the browser time to start the download before revoking the object URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Bleed in its own unit for the file name: `bleed0.125in`, `bleed3mm`, or `trim` for none. */
function bleedFileToken(bleedMm: number): string {
    if (bleedMm === 0) {
        return 'trim';
    }
    const eighths = (bleedMm / 25.4) * 8;
    return Math.abs(eighths - Math.round(eighths)) < 1e-6
        ? `bleed${+(bleedMm / 25.4).toFixed(3)}in`
        : `bleed${+bleedMm.toFixed(3)}mm`;
}

/** PDF file name (no extension) of the print-shop board as the controls set it. */
function shopExportBasename(shopSizeId: ShopSizeId): string {
    const parts = [
        'skellychart-printshop',
        shopSizeId,
        `${state.squaresX}x${state.squaresY}`,
        `${state.squareMm}mm`,
        bleedFileToken(bleedMmForUnit(state.shopBleed, state.shopUnit)),
        ...(state.shopCropMarks ? ['crop'] : []),
    ];
    return parts.join('-').replace(/[^\w.-]+/g, '_');
}

/** PDF file name (no extension) of a home chart. */
function chartExportBasename(chart: PrintedChart): string {
    const parts = ['skellychart', chart.paperId, `${chart.squaresX}x${chart.squaresY}`, `${chart.squareMm}mm`];
    return parts.join('-').replace(/[^\w.-]+/g, '_');
}

/**
 * A shop board is printed once, at cost, and its QR must open the released generator: only release builds
 * whose QR targets skelly.cam make the file. Dev builds may, after confirming it is a test.
 */
function shopExportAllowed(): boolean {
    const v = parseChartVersion(APP_VERSION);
    const release = v !== null && v.prerelease === null && resolveQrLinkSourceUrl().startsWith('https://skelly.cam/c/');
    if (release) {
        return true;
    }
    if (IS_DEV) {
        return window.confirm(interpolate(S.shopTestBuildConfirm, {version: APP_VERSION}));
    }
    showErr(S.shopReleaseOnly);
    return false;
}

/**
 * Runs an export with `btn` busy (spinner and `busyLabel`); the task may relabel it to show progress.
 * {@link syncExportButtons} leaves a busy button's label alone, and gets the button back in `finally`.
 * A cancelled export ends quietly; any other failure is shown.
 */
async function runBusy(
    btn: HTMLButtonElement,
    busyLabel: string,
    task: (setLabel: (label: string) => void) => Promise<void>,
): Promise<void> {
    if (isBusy(btn)) {
        return;
    }
    btn.dataset.busy = '';
    btn.classList.add('btn--busy');
    btn.textContent = busyLabel;
    syncExportButtons();
    try {
        await task((label) => {
            btn.textContent = label;
        });
    } catch (e) {
        if ((e as Error).name !== 'AbortError') {
            showErr(e instanceof Error ? e.message : String(e));
        }
    } finally {
        delete btn.dataset.busy;
        btn.classList.remove('btn--busy');
        syncExportButtons();
    }
}

/** {@link runBusy} on the Save button, which reads Cancel meanwhile: clicking it aborts `signal`. */
async function runPdfExport(
    task: (signal: AbortSignal, setLabel: (label: string) => void) => Promise<void>,
): Promise<void> {
    const abort = new AbortController();
    pdfExportAbort = abort;
    await runBusy(byId('btnSavePdf') as HTMLButtonElement, S.cancelPdfExport, (setLabel) => task(abort.signal, setLabel));
    pdfExportAbort = null;
}

async function saveShopPdf(): Promise<void> {
    const layout = shopLayoutNow();
    if (!layout || !state.shopSizeId) {
        return;
    }
    if (!shopExportAllowed()) {
        return;
    }
    // Snapshot the board so control changes during the export cannot mismatch the file and its name.
    const board = {squaresX: state.squaresX, squaresY: state.squaresY, squareMm: state.squareMm};
    const size = {id: state.shopSizeId, unit: state.shopUnit};
    const options = shopOptions();
    const prefix = shopExportBasename(state.shopSizeId);
    await runPdfExport(async (signal) => {
        await yieldToMain();
        const {renderShopPrintSvg, SHOP_CMYK_BY_RGB, shopPdfProperties} = await import('./print/shopSheet.js');
        const sheet = await renderShopPrintSvg({...board, layout, size, options});
        const blob = await buildPdfBlobFromSvgPages(
            [{svg: sheet.svg, widthMm: sheet.mediaMm.w, heightMm: sheet.mediaMm.h}],
            undefined,
            {
                shop: {
                    trimBoxMm: sheet.trimBoxMm,
                    bleedBoxMm: sheet.bleedBoxMm,
                    cmykByRgb: SHOP_CMYK_BY_RGB,
                    ...shopPdfProperties({...board, layout, size, chartUrl: sheet.chartUrl}),
                },
                signal,
            },
        );
        downloadBlob(blob, `${prefix}.pdf`);
    });
}

async function savePdfFile(): Promise<void> {
    if (pdfExportAbort) {
        pdfExportAbort.abort();
        return;
    }
    showErr(null);
    if (state.mode === 'shop') {
        await saveShopPdf();
        return;
    }
    // Snapshot the chart before yielding so slider/paper changes during the export cannot
    // produce a PDF that differs from the filename or the layout we measured.
    const chart = snapshotChart();
    if (!chart) {
        return;
    }
    const {paperWMm, paperHMm} = chart.tiling;
    await runPdfExport(async (signal, setLabel) => {
        await yieldToMain();
        const r = await renderCharucoPrintSvg(chart, {
            // Keep the busy label/spinner alive while many sheets are assembled.
            betweenSheets: () => yieldToMainUnlessAborted(signal),
        });
        const blob = await buildPdfBlobFromSvgPages(
            printOrder(r).map((svg) => ({svg, widthMm: paperWMm, heightMm: paperHMm})),
            ({current, total}) => {
                setLabel(interpolate(S.cancelPdfExportPage, {current, total}));
            },
            {signal},
        );
        downloadBlob(blob, `${chartExportBasename(chart)}.pdf`);
    });
}

/** The last print job's hidden iframe (see {@link printHtmlDocumentInHiddenIframe}). */
let printFrame: HTMLIFrameElement | null = null;

function printHtmlDocumentInHiddenIframe(html: string): void {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.title = 'Print';
    Object.assign(iframe.style, {
        position: 'fixed',
        right: '0',
        bottom: '0',
        width: '0',
        height: '0',
        border: '0',
        visibility: 'hidden',
    });
    printFrame?.remove();
    printFrame = null;
    document.body.appendChild(iframe);

    const printWin = iframe.contentWindow;
    const printDoc = iframe.contentDocument;
    if (!printWin || !printDoc) {
        iframe.remove();
        showErr(S.printInitFailed);
        return;
    }

    // Kept until the next print: where print() returns before the dialog closes, removing it would pull
    // the document out from under an open dialog.
    printFrame = iframe;
    printDoc.open();
    printDoc.write(html);
    printDoc.close();

    const invokePrint = (): void => {
        printWin.focus();
        printWin.print();
    };

    if (printDoc.readyState === 'complete') {
        queueMicrotask(invokePrint);
    } else {
        printWin.addEventListener('load', () => queueMicrotask(invokePrint), {once: true});
    }
}

async function openPrintDialog(): Promise<void> {
    showErr(null);
    // A print-shop board is only ever a downloaded PDF (the button is hidden in that mode).
    if (state.mode === 'shop') {
        return;
    }
    // Snapshot the chart before yielding, as Save does, so a control change cannot mix two layouts.
    const chart = snapshotChart();
    if (!chart) {
        return;
    }
    await runBusy(byId('btnPdf') as HTMLButtonElement, S.preparingPrint, async () => {
        await yieldToMain();

        const r = await renderCharucoPrintSvg(chart);
        const {paperWMm, paperHMm} = chart.tiling;
        const [pageWCss, pageHCss] = svgRootOuterSizeAttrs(paperWMm, paperHMm, paperById(chart.paperId).units);
        // Joined once: a many-sheet chart is tens of MB of SVG. The guide is on the chart sheets' paper, so
        // one @page covers the whole job.
        const html = [
            `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>` +
                `<title>ChArUco print</title><style>` +
                `@page{size:${pageWCss} ${pageHCss};margin:0}` +
                `*{box-sizing:border-box}` +
                `html,body{margin:0;padding:0}` +
                `.sheet{width:${pageWCss};height:${pageHCss};margin:0;` +
                `page-break-after:always;break-after:page;overflow:hidden}` +
                `.sheet:last-child{page-break-after:auto;break-after:auto}` +
                `.sheet>svg{display:block;width:${pageWCss};height:${pageHCss}}` +
                `</style></head><body>`,
            ...printOrder(r).map((svg) => `<div class="sheet">${stripXmlDeclaration(svg)}</div>`),
            `</body></html>`,
        ].join('');

        printHtmlDocumentInHiddenIframe(html);
    });
}

function clampInt(n: number, lo: number, hi: number): number {
    return Math.round(Math.max(lo, Math.min(hi, n)));
}

function applyQrQueryFromLocation(): void {
    const sp = new URLSearchParams(window.location.search);
    const parsed = parseCharucoQrSearchParams(sp);
    const warnings: string[] = [];

    const currentVersion = parseChartVersion(APP_VERSION);
    if (
        parsed.chartVersionRaw !== null &&
        parsed.chartVersion !== null &&
        currentVersion !== null &&
        compareChartVersions(parsed.chartVersion, currentVersion) > 0
    ) {
        warnings.push(
            interpolate(S.qrChartNewer, {
                theirs: parsed.chartVersionRaw,
                ours: APP_VERSION,
            }),
        );
    }

    if (parsed.squaresX !== null || parsed.squaresY !== null || parsed.squareLengthMm !== null) {
        const seen = (history.state as {skScanSeen?: boolean} | null)?.skScanSeen === true;
        if (!seen && parsed.squaresX !== null && parsed.squaresY !== null && parsed.squareLengthMm !== null) {
            scannedChart = {
                squaresX: parsed.squaresX,
                squaresY: parsed.squaresY,
                squareMm: parsed.squareLengthMm,
                shop: parsed.printMode === 'shop',
            };
            history.replaceState({...(history.state as object | null), skScanSeen: true}, '');
        }
        state.autoGrid = false;
        if (parsed.squaresX !== null) {
            state.squaresX = clampInt(parsed.squaresX, BOARD_GRID_MIN, BOARD_GRID_MAX);
        }
        if (parsed.squaresY !== null) {
            state.squaresY = clampInt(parsed.squaresY, BOARD_GRID_MIN, BOARD_GRID_MAX);
        }
        // Older generators let a board outgrow the marker dictionary; keep X and end-stop Y as the slider does.
        const linkedSquaresY = state.squaresY;
        state.squaresY = Math.min(state.squaresY, boardGridAxisMax(state.squaresX));
        if (state.squaresY !== linkedSquaresY) {
            warnings.push(
                interpolate(S.qrGridClamped, {
                    theirs: `${state.squaresX} × ${linkedSquaresY}`,
                    ours: `${state.squaresX} × ${state.squaresY}`,
                    markers: BOARD_MARKERS_MAX,
                }),
            );
        }
        if (parsed.paperId !== null) {
            state.paperId = parsed.paperId;
        }
        if (parsed.printMode === 'shop') {
            applyShopLink(parsed, warnings);
        }
    }
    if (state.mode !== 'shop' && (parsed.squaresX !== null || parsed.squaresY !== null || parsed.squareLengthMm !== null)) {
        const pd = paperDims();
        if (parsed.squareLengthMm !== null) {
            state.squareMm = Math.round(parsed.squareLengthMm);
        }
        const linkedSquareMm = state.squareMm;
        const snapped = snapSquareMm(state.squareMm, state.squaresX, state.squaresY, pd.wMm, pd.hMm);
        if (snapped !== null) {
            state.squareMm = snapped;
        }
        // A link is not a slider: pick the largest distance whose minimum this square length meets.
        state.distanceId = workingDistanceTierFromSquareLengthMm(state.squareMm);
        linkSquareMm = state.squareMm !== linkedSquareMm ? linkedSquareMm : null;
    }

    qrVersionBannerMessage = warnings.length ? warnings.join(' ') : null;
}

/**
 * A print-shop link (`t` field) reopens the board on its size, unit, bleed and crop marks. A size that is
 * unreadable or no longer fits falls back to the default size; a board no size fits opens for home paper.
 * Each fallback adds a notice. The board itself (X, Y, square length) is kept exactly.
 */
function applyShopLink(parsed: ReturnType<typeof parseCharucoQrSearchParams>, warnings: string[]): void {
    if (parsed.shopSize) {
        state.shopUnit = parsed.shopSize.unit;
    }
    if (parsed.shopOptionsError) {
        warnings.push(S.qrShopOptionsFallback);
    }
    if (parsed.shopOptions) {
        const {bleed, cropMarks} = parsed.shopOptions;
        // The standard bleed written as its fixed value is still the standard bleed.
        const isStd = bleed !== 'std' && Math.abs(bleed.mm - shopStandardBleedMm(state.shopUnit)) < 1e-9;
        state.shopBleed = isStd ? 'std' : bleed;
        state.shopCropMarks = cropMarks;
    }
    if (parsed.squareLengthMm !== null) {
        state.squareMm = clampInt(parsed.squareLengthMm, CHARUCO_SQUARE_MM_MIN, SHOP_SQUARE_MM_MAX);
    }
    state.distanceId = workingDistanceTierFromSquareLengthMm(state.squareMm);
    const {squaresX, squaresY, squareMm} = state;
    if (parsed.shopSize && shopSheetLayout(squaresX, squaresY, squareMm, parsed.shopSize.id)) {
        state.mode = 'shop';
        state.shopSizeId = parsed.shopSize.id;
        return;
    }
    const fallback = smallestFittingShopSize(squaresX, squaresY, squareMm, state.shopUnit);
    if (!fallback) {
        warnings.push(S.qrShopTooLarge);
        return;
    }
    state.mode = 'shop';
    state.shopSizeId = fallback;
    const ours = shopSizeById(fallback).name;
    warnings.push(
        parsed.shopSize
            ? interpolate(S.qrShopSizeNoFit, {theirs: shopSizeById(parsed.shopSize.id).name, ours})
            : interpolate(S.qrShopSizeFallback, {size: ours}),
    );
}

/** The user took over the board: stop re-fitting to the link's square length and drop its notice. */
function forgetLinkSquare(): void {
    if (linkSquareMm !== null) {
        linkSquareMm = null;
        syncQrVersionBanner();
    }
}

function syncQrVersionBanner(): void {
    const el = byId('qrVersionBanner');
    const snapNotice =
        linkSquareMm === null
            ? null
            : interpolate(S.qrSquareSnapped, {
                  theirs: linkSquareMm,
                  ours: state.squareMm,
                  paper: paperLabel(state.paperId),
              });
    const message = [qrVersionBannerMessage, snapNotice].filter((m) => m !== null).join(' ');
    if (message) {
        el.textContent = message;
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
        el.textContent = '';
    }
}

function wireUi(): void {
    window.addEventListener(
        'pointerdown',
        (e) => {
            if (e.target instanceof HTMLInputElement && e.target.type === 'range') {
                rangePointerHeld = true;
            }
        },
        true,
    );
    window.addEventListener('pointerup', finalizeRangeGesture, true);
    window.addEventListener('pointercancel', finalizeRangeGesture, true);

    const distanceSel = byId('distance') as HTMLSelectElement;
    /** Native `<select>` does not fire `change` when re-picking the same option; briefly clear selection so it always fires. */
    let pendingDistanceRestore: string | null = null;
    /** After clearing, ignore further primary-button downs until closed (`change`) or cancelled (`blur`). */
    let distanceArmClearForNextPrimaryDown = true;

    distanceSel.addEventListener('mousedown', (e) => {
        if (e.button !== 0) {
            return;
        }
        if (!distanceArmClearForNextPrimaryDown) {
            return;
        }
        distanceArmClearForNextPrimaryDown = false;
        pendingDistanceRestore = distanceSel.value;
        suppressDistanceSelectUiClamp = true;
        distanceSel.selectedIndex = -1;
    });

    distanceSel.addEventListener('change', (e) => {
        pendingDistanceRestore = null;
        suppressDistanceSelectUiClamp = false;
        distanceArmClearForNextPrimaryDown = true;
        const distanceId = (e.target as HTMLSelectElement).value;
        if (isWorkingDistanceId(distanceId)) {
            state.distanceId = distanceId;
        }
        state.autoGrid = true;
        clearTransientNotices();
        forgetLinkSquare();
        syncUi();
    });

    distanceSel.addEventListener('blur', () => {
        distanceArmClearForNextPrimaryDown = true;
        suppressDistanceSelectUiClamp = false;
        if (pendingDistanceRestore !== null && distanceSel.selectedIndex < 0) {
            const restore = pendingDistanceRestore;
            pendingDistanceRestore = null;
            distanceSel.value = restore;
        } else {
            pendingDistanceRestore = null;
        }
    });

    (byId('paper') as HTMLSelectElement).addEventListener('change', (e) => {
        const paperId = (e.target as HTMLSelectElement).value;
        if (isPaperId(paperId)) {
            state.paperId = paperId;
        }
        if (!state.autoGrid) {
            // Keep the board the user set (or opened from a link); re-fit only the square length, from
            // the link's own size while it is still pending, so the chart's paper restores it exactly.
            const pd = paperDims();
            const wanted = linkSquareMm ?? state.squareMm;
            const snapped = snapSquareMm(wanted, state.squaresX, state.squaresY, pd.wMm, pd.hMm);
            if (snapped !== null) {
                setSquareFollowingBand(snapped);
            }
            if (linkSquareMm !== null && state.squareMm === linkSquareMm) {
                linkSquareMm = null;
            }
            syncQrVersionBanner();
        }
        syncUi();
    });

    const sqmmEl = byId('sqmm') as HTMLInputElement;
    sqmmEl.addEventListener('input', (e) => {
        state.autoGrid = false;
        forgetLinkSquare();
        clearTransientNotices();
        const raw = Number((e.target as HTMLInputElement).value);
        const snapped = snapSquareForMode(raw);
        if (snapped !== null) {
            setSquareFollowingBand(snapped);
        }
        scheduleSyncUi();
    });

    wirePageStepButton(byId('pagesFewer'), 'fewer');
    wirePageStepButton(byId('pagesMore'), 'more');
    const pageStepKeys: Record<string, PageStepTarget> = {
        ArrowLeft: 'fewer',
        ArrowDown: 'fewer',
        ArrowRight: 'more',
        ArrowUp: 'more',
        Home: 'fewest',
        End: 'most',
    };
    byId('pagesGroup').addEventListener('keydown', (e) => {
        if (e.altKey || e.ctrlKey || e.metaKey) {
            return;
        }
        const which = pageStepKeys[e.key];
        if (which) {
            e.preventDefault();
            stepPages(which);
        }
    });

    const sxEl = byId('sx') as HTMLInputElement;
    sxEl.addEventListener('input', (e) => {
        state.autoGrid = false;
        forgetLinkSquare();
        clearTransientNotices();
        setGridSize('squaresX', Number((e.target as HTMLInputElement).value));
        scheduleSyncUi();
    });

    const syEl = byId('sy') as HTMLInputElement;
    syEl.addEventListener('input', (e) => {
        state.autoGrid = false;
        forgetLinkSquare();
        clearTransientNotices();
        setGridSize('squaresY', Number((e.target as HTMLInputElement).value));
        scheduleSyncUi();
    });

    for (const btn of byId('modeToggle').querySelectorAll<HTMLButtonElement>('[data-mode]')) {
        btn.addEventListener('click', () => setMode(btn.dataset.mode === 'shop' ? 'shop' : 'home'));
    }
    for (const btn of byId('shopUnitToggle').querySelectorAll<HTMLButtonElement>('[data-unit]')) {
        btn.addEventListener('click', () => {
            state.shopUnit = btn.dataset.unit === 'in' ? 'in' : 'mm';
            syncUi();
        });
    }
    (byId('shopSize') as HTMLSelectElement).addEventListener('change', (e) => {
        const sizeId = (e.target as HTMLSelectElement).value as ShopSizeId;
        state.autoGrid = false;
        forgetLinkSquare();
        clearTransientNotices();
        state.shopSizeId = sizeId;
        // Keep the board; re-fit only the square, staying in the working distance's band if the size allows.
        const bandMin = workingDistanceMinSquareMm(state.distanceId);
        let squareMm = snapShopSquareMm(state.squareMm, state.squaresX, state.squaresY, sizeId, bandMin);
        if (squareMm === null) {
            squareMm = maxShopSquareMm(state.squaresX, state.squaresY, sizeId);
            if (squareMm !== null) {
                shopSizeHint = interpolate(S.shopSizeBandHint, {
                    distance: distanceLabel(state.distanceId, prefersImperialUnits()),
                    size: shopSizeById(sizeId).name,
                    mm: squareMm,
                });
            }
        }
        if (squareMm !== null) {
            setSquareFollowingBand(squareMm);
        }
        syncUi();
    });
    (byId('shopBleed') as HTMLSelectElement).addEventListener('change', (e) => {
        const v = (e.target as HTMLSelectElement).value;
        state.shopBleed = v === 'std' ? 'std' : {mm: Number(v)};
        storeShopOptions();
        syncUi();
    });
    (byId('shopCropMarks') as HTMLInputElement).addEventListener('change', (e) => {
        state.shopCropMarks = (e.target as HTMLInputElement).checked;
        storeShopOptions();
        syncUi();
    });

    byId('btnCopyOrder').addEventListener('click', () => void copyShopOrder());
    byId('btnPdf').addEventListener('click', () => void openPrintDialog());
    byId('btnSavePdf').addEventListener('click', () => void savePdfFile());

    const themeGroup = byId('themeToggle');
    for (const btn of themeGroup.querySelectorAll<HTMLButtonElement>('[data-theme-pick]')) {
        btn.addEventListener('click', () => {
            setStoredPreference(btn.dataset.themePick as ThemePreference);
            applyThemePreference(getStoredPreference());
            syncThemeToggle();
        });
    }
}

function boot(): void {
    (byId('brandLogo') as HTMLImageElement).src = freemocapLogoUrl;
    initTheme();
    scaleScene = mountScaleScene(byId('scaleScene'), prefersImperialUnits);
    wireUi();
    initAdvancedFoldout();
    // A literal in release builds, so the dev-only UI is left out of the bundle.
    if (IS_DEV) {
        initDevQrLinkTargetUi();
    }
    applyQrQueryFromLocation();
    syncQrVersionBanner();
    syncUi();
    renderScanCard();
}

boot();
