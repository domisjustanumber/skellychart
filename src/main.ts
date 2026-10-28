import {APP_VERSION} from './appVersion.js';
import freemocapLogoUrl from './freemocapLogoUrl.js';
import {renderCharucoPrintSvg} from './print/svgDocument.js';
import {
    BOARD_GRID_MAX,
    BOARD_GRID_MIN,
    BOARD_MARKERS_MAX,
    boardGridAxisMax,
    CHARUCO_SQUARE_MM_MAX,
    CHARUCO_SQUARE_MM_MIN,
    PAPER_OPTIONS,
    paperById,
    charucoPagePreviewBorderColor,
    computeEffectivePrintLayout,
    defaultPaperId,
    defaultRegion,
    layoutSummaryText,
    maxSquareMmForGridAndPages,
    resolveDistancePrintPlan,
    shouldUseImperialWorkingDistanceUnits,
    snapSquareMm,
    squareLengthTierBandEdgeFractions,
    pageStepNeighbours,
    steppablePageCounts,
    type PageStep,
    validTargetPageCountsForGrid,
    workingDistanceMinSquareMm,
    workingDistanceTierFromSquareLengthMm,
} from './print/charucoLayout.js';
import {buildPageSpecs, nominalPaperToPdfDimensionsMm, printedSheetCount} from './print/tiling.js';
import {perfDev, perfLog} from './print/perfDebug.js';
import {CHARUCO_MARKER_LENGTH_RATIO, getCharucoPrintSourceUrl, getCharucoPrintSourceUrlFor} from './print/constants.js';
import {compareChartVersions, parseChartVersion} from './print/chartVersion.js';
import {svgRootOuterSizeAttrs} from './print/svgUtils.js';
import {
    buildCharucoDocumentationUrl,
    expectedCharucoCv2QueryValue,
    mergeCharucoQrParamsInto,
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
    setQrLinkTarget,
} from './print/qrLinkTarget.js';
import {
    MAX_PREVIEW_PAGES,
    PREVIEW_DEBOUNCE_IDLE_MS,
    PREVIEW_DEBOUNCE_INTERACTIVE_MS,
    svgToDataUrl,
} from './ui/previewSvg.js';
import {buildPdfBlobFromSvgPages} from './ui/pdfExport.js';
import {yieldToMain} from './ui/yieldToMain.js';
import {
    applyThemePreference,
    getStoredPreference,
    initTheme,
    setStoredPreference,
    type ThemePreference,
} from './ui/theme.js';
import {
    FREEMOCAP_CALIBRATION_DOCS_MULTI_CAM_URL,
    bandLabel,
    distanceSelectLabel,
    interpolate,
    paperLabel,
    paperOptionDimensions,
    S,
    sheetCountPhrase,
    sheetsShort,
} from './ui/strings.js';

const PRESET_IDS = ['close', 'near', 'far'] as const;

/** Default working-distance preset (2–4 m); labelled “(recommended)” in the dropdown. */
const DEFAULT_WORKING_DISTANCE_ID = 'near' as const satisfies (typeof PRESET_IDS)[number];

function normalizeWorkingDistanceId(id: string): (typeof PRESET_IDS)[number] {
    if (id === 'far') {
        return 'far';
    }
    if (id === 'close') {
        return 'close';
    }
    return DEFAULT_WORKING_DISTANCE_ID;
}

function initialBoard(): {paperId: string; squareMm: number; squaresX: number; squaresY: number} {
    const paperId = defaultPaperId();
    const paper = paperById(paperId) ?? PAPER_OPTIONS[0]!;
    const plan = resolveDistancePrintPlan(DEFAULT_WORKING_DISTANCE_ID, paperId);
    const squareMm =
        maxSquareMmForGridAndPages(plan.squaresX, plan.squaresY, paper.wMm, paper.hMm, plan.targetPages) ?? 54;
    return {paperId, squareMm, squaresX: plan.squaresX, squaresY: plan.squaresY};
}

const defaultBoard = initialBoard();

interface AppState {
    distanceId: (typeof PRESET_IDS)[number];
    /** "My printer" (tiled sheets of `paperId`) or "Print shop" (one board of `shopSizeId`). */
    mode: PrintMode;
    /** Home paper; kept while in print-shop mode so switching back restores it. */
    paperId: string;
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
    distanceId: DEFAULT_WORKING_DISTANCE_ID,
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

function resetPreviewVisualsEmpty(): void {
    // The hint describes the printed sheets, so it must not outlive them (e.g. after a render error).
    byId('fullChartHint').classList.add('hidden');
    byId('thumbGrid').innerHTML = '';
}

function paperDims() {
    return paperById(state.paperId) ?? PAPER_OPTIONS[0]!;
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
    return computeEffectivePrintLayout(state.squaresX, state.squaresY, state.squareMm, pd.wMm, pd.hMm);
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
function linkTarget(): string | LinkTarget {
    return state.mode === 'shop' && state.shopSizeId
        ? {kind: 'shop', size: {id: state.shopSizeId, unit: state.shopUnit}, options: shopOptions()}
        : state.paperId;
}

/** Whether the current mode has something to print and export. */
function hasPrintableLayout(): boolean {
    if (state.mode === 'shop') {
        return shopLayoutNow() !== null;
    }
    const t = effectiveTiling();
    return t !== null && t.pageCount >= 1;
}

/** The square slider's end: print-shop boards go up to {@link SHOP_SQUARE_MM_MAX}. */
function squareSliderMaxMm(): number {
    return state.mode === 'shop' ? SHOP_SQUARE_MM_MAX : CHARUCO_SQUARE_MM_MAX;
}

/** Nearest square length (at or above `minSquareMm`) the board prints at in the current mode. */
function snapSquareForMode(raw: number, minSquareMm?: number): number | null {
    if (state.mode === 'shop') {
        return state.shopSizeId
            ? snapShopSquareMm(raw, state.squaresX, state.squaresY, state.shopSizeId, minSquareMm)
            : null;
    }
    const pd = paperDims();
    return snapSquareMm(raw, state.squaresX, state.squaresY, pd.wMm, pd.hMm, minSquareMm);
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
 * Switches between "My printer" and "Print shop". X, Y and the distance never change without telling the
 * user: entering print-shop mode keeps the board on the smallest size that fits it, shrinks the square
 * within its band if it must (with a notice), or refuses (with a message).
 */
function setMode(mode: PrintMode): void {
    if (mode === state.mode) {
        return;
    }
    clearTransientNotices();
    if (mode === 'shop' && !state.autoGrid) {
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
    state.mode = mode;
    if (mode === 'home' && !state.autoGrid) {
        // Print-shop squares may be larger than home paper allows; keep the nearest that prints.
        const snapped = snapSquareForMode(state.squareMm);
        if (snapped !== null) {
            setSquareFollowingBand(snapped);
        }
    }
    forgetLinkSquare();
    syncUi({previewDelayMs: 0});
}

function pagesSliderDisplay(tiling: ReturnType<typeof effectiveTiling>): number {
    return tiling?.pageCount ?? 1;
}

/** Stops of the sheets stepper for the current grid, paper and working distance. */
function pageSteps(): PageStep[] {
    const pd = paperDims();
    return steppablePageCounts(state.squaresX, state.squaresY, pd.wMm, pd.hMm, distanceMinSquareMm());
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
        const fewestAnyDistance = validTargetPageCountsForGrid(state.squaresX, state.squaresY, pd.wMm, pd.hMm)[0];
        hint =
            fewestAnyDistance !== undefined && fewestAnyDistance < count
                ? interpolate(S.pagesFewestHint, {distance: bandLabel(state.distanceId, imperial), mm: distanceMinSquareMm()})
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
        // Keeps the preview on the short interactive debounce while held (cleared on window pointerup).
        rangePointerHeld = true;
        delayTimer = window.setTimeout(() => {
            readout.setAttribute('aria-live', 'off');
            repeatTimer = window.setInterval(() => {
                repeated = true;
                if (!stepPages(which)) {
                    stop();
                }
            }, 120);
        }, 400);
    });
    btn.addEventListener('pointerup', stop);
    for (const type of ['pointercancel', 'lostpointercapture', 'blur']) {
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

/** Smallest square length the selected working distance allows; the Pages slider end-stops here and never changes distance. */
function distanceMinSquareMm(): number {
    return workingDistanceMinSquareMm(state.distanceId);
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

let previewTimer: ReturnType<typeof setTimeout> | null = null;
let previewAbort: AbortController | null = null;
/** Bumped when a new preview run starts so stale async completions do not clear the busy UI. */
let previewGeneration = 0;
/** Prevents a second PDF export while one is running (e.g. after a slider drag re-runs syncUi). */
let pdfExportInProgress = false;

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
/** Last preview timer delay chosen (for perf logging). */
let lastScheduledPreviewDelayMs = PREVIEW_DEBOUNCE_IDLE_MS;

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

function finalizeRangeGestureUi(): void {
    rangePointerHeld = false;
    if (syncUiRafId !== null) {
        window.cancelAnimationFrame(syncUiRafId);
        syncUiRafId = null;
    }
    syncUi({lite: false, previewDelayMs: 0});
}

function wireRangeResponsiveUi(el: HTMLInputElement): void {
    el.addEventListener('pointerdown', () => {
        rangePointerHeld = true;
    });
}

function finalizeRangeGestureIfNeeded(): void {
    if (!rangePointerHeld) {
        return;
    }
    finalizeRangeGestureUi();
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

/** Keeps {@link window.location} query `v,w,h,s,cv2` aligned with QR / exported charts. */
function syncAddressBarChartQuery(): void {
    const {squaresX, squaresY} = state;
    const u = new URL(window.location.href);
    mergeCharucoQrParamsInto(u.searchParams, squaresX, squaresY, state.squareMm, linkTarget());
    const next = `${u.pathname}${u.search}${u.hash}`;
    const cur = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next === cur) {
        return;
    }
    window.history.replaceState(history.state, '', next);
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
            getCharucoPrintSourceUrlFor(qrTarget),
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
    const t0 = perfDev() ? performance.now() : 0;
    if (syncUiRafId !== null) {
        window.cancelAnimationFrame(syncUiRafId);
        syncUiRafId = null;
    }
    state.distanceId = normalizeWorkingDistanceId(state.distanceId);
    applyAutoPreset();
    const imperial = shouldUseImperialWorkingDistanceUnits();
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
        (byId('btnPdf') as HTMLButtonElement).textContent = S.printCharts;
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
        s1.textContent = bandLabel('close', imperial);
        const s2 = document.createElement('span');
        s2.style.width = `${Math.max(0, pNearEnd - pCloseEnd)}%`;
        s2.style.color = 'var(--near)';
        s2.textContent = bandLabel('near', imperial);
        const s3 = document.createElement('span');
        s3.style.flex = '1';
        s3.style.color = 'var(--far)';
        s3.textContent = bandLabel('far', imperial);
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
    const distanceSelectKey = `${imperial}:${(PRESET_IDS as readonly string[]).join('|')}`;
    if (distanceSelectKey !== syncedDistanceSelectKey) {
        syncedDistanceSelectKey = distanceSelectKey;
        distSel.innerHTML = '';
        for (const id of PRESET_IDS) {
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
    const paperSelectKey = PAPER_OPTIONS.map((p) => p.id).join('|');
    if (paperSelectKey !== syncedPaperSelectKey) {
        syncedPaperSelectKey = paperSelectKey;
        paperSel.innerHTML = '';
        for (const p of PAPER_OPTIONS) {
            const o = document.createElement('option');
            o.value = p.id;
            o.textContent = interpolate(S.paperOption, {
                paper: paperLabel(p.id),
                dims: paperOptionDimensions(p.id, p.wMm, p.hMm),
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

    const btnPdf = byId('btnPdf') as HTMLButtonElement;
    const btnSavePdf = byId('btnSavePdf') as HTMLButtonElement;
    const exportDisabled = !hasPrintableLayout();
    btnPdf.disabled = exportDisabled;
    btnSavePdf.disabled = exportDisabled || pdfExportInProgress;
    // Print shop: the PDF is the deliverable, so Print goes and the download becomes the main action.
    const shop = state.mode === 'shop';
    btnPdf.classList.toggle('hidden', shop);
    btnSavePdf.classList.toggle('btn-primary', shop);
    btnSavePdf.classList.toggle('btn-secondary', !shop);
    if (!pdfExportInProgress) {
        btnSavePdf.textContent = shop ? S.shopDownload : S.savePdfFiles;
    }

    if (!lite) {
        syncThemeToggle();
        showErr(null);
    }
    if (perfDev()) {
        const dt = performance.now() - t0;
        if (dt > 16) {
            perfLog(
                'syncUi (before schedulePreview debounce)',
                dt,
                lite ? 'lite: sliders → reduced DOM refresh' : 'full: distance/paper / range release → DOM refresh',
            );
        }
    }
    syncAddressBarChartQuery();
    if (import.meta.env.DEV) {
        syncDevQrLinkTargetUi();
    }
    schedulePreview(previewDelayMs);
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
    const scheduleBaselineMs = perfDev() ? performance.now() : undefined;
    lastScheduledPreviewDelayMs =
        delayOverride !== undefined
            ? delayOverride
            : rangePointerHeld
              ? PREVIEW_DEBOUNCE_INTERACTIVE_MS
              : PREVIEW_DEBOUNCE_IDLE_MS;
    previewTimer = setTimeout(() => {
        previewTimer = null;
        void runPreview(scheduleBaselineMs);
    }, lastScheduledPreviewDelayMs);
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

function flushPreviewImgLayoutReads(thumbsRoot: HTMLElement): void {
    for (const img of thumbsRoot.querySelectorAll<HTMLImageElement>('img.thumb-img')) {
        void img.offsetWidth;
    }
}

/**
 * After assigning SVG data URLs to `<img>`, the slow part is often **paint/composite**, which
 * happens *after* `decode()` resolves. We still `decode()` (readiness), force layout reads, then
 * wait **2× requestAnimationFrame** as a rough proxy for “about to paint”.
 */
async function awaitPreviewImagesDecodedAndPaint(thumbsRoot: HTMLElement): Promise<void> {
    const tDecode = perfDev() ? performance.now() : 0;
    const pending: Promise<void>[] = Array.from(thumbsRoot.querySelectorAll<HTMLImageElement>('img.thumb-img'), (im) =>
        im.decode().catch(() => {}),
    );
    await Promise.all(pending);
    if (perfDev()) {
        perfLog('browser <img> decode()', performance.now() - tDecode, `${pending.length} images`);
    }

    flushPreviewImgLayoutReads(thumbsRoot);

    const tRaf = perfDev() ? performance.now() : 0;
    await waitAnimationFrames(2);
    if (perfDev()) {
        perfLog('2× requestAnimationFrame after decode (paint proxy)', performance.now() - tRaf);
    }
}

async function runPreview(scheduleBaselineMs?: number): Promise<void> {
    previewAbort?.abort();
    previewAbort = new AbortController();
    const signal = previewAbort.signal;
    const runId = ++previewGeneration;

    const endPreviewBusyIfCurrent = (): void => {
        if (runId !== previewGeneration) {
            return;
        }
        byId('panelPreview').setAttribute('aria-busy', 'false');
    };

    const tiling = effectiveTiling();
    const statusEl = byId('previewStatus') as HTMLParagraphElement;
    const panelPreview = byId('panelPreview');
    const fullBlock = byId('fullPreviewBlock');
    const thumbs = byId('thumbGrid');
    const trunc = byId('previewTruncated');

    if (state.mode === 'shop') {
        await runShopPreview(signal, runId);
        endPreviewBusyIfCurrent();
        return;
    }

    if (!tiling || tiling.pageCount < 1) {
        statusEl.textContent = '';
        panelPreview.setAttribute('aria-busy', 'false');
        fullBlock.classList.add('hidden');
        resetPreviewVisualsEmpty();
        trunc.classList.add('hidden');
        return;
    }

    panelPreview.setAttribute('aria-busy', 'true');
    statusEl.textContent = '';
    // Assembly instructions only make sense when the chart spans several sheets.
    fullBlock.classList.toggle('hidden', tiling.pageCount <= 1);
    setThumbGridPlaceholder(S.loadingPreviews);
    await yieldToMain();

    try {
        const previewWallStart = perfDev() ? performance.now() : 0;

        const {squaresX: px, squaresY: py} = state;
        const pd = paperDims();
        const {paperWMm, paperHMm} = nominalPaperToPdfDimensionsMm(pd.wMm, pd.hMm, tiling);

        const allPages = buildPageSpecs(px, py, tiling).pages;
        // Only the thumbnails that are shown are rendered; sheet headers still count every chart sheet.
        const pages = allPages.slice(0, MAX_PREVIEW_PAGES);

        let printResult: Awaited<ReturnType<typeof renderCharucoPrintSvg>>;
        try {
            printResult = await renderCharucoPrintSvg({
                paperId: state.paperId,
                squaresX: px,
                squaresY: py,
                squareLengthMm: state.squareMm,
                paperWMm,
                paperHMm,
                markerLengthRatio: CHARUCO_MARKER_LENGTH_RATIO,
                tiling,
                pages,
                totalPages: allPages.length,
                signal,
                cooperativeYield: true,
            });
        } catch (e) {
            if ((e as Error).name === 'AbortError') {
                return;
            }
            statusEl.textContent = e instanceof Error ? e.message : String(e);
            resetPreviewVisualsEmpty();
            return;
        }

        if (signal.aborted) {
            return;
        }

        setThumbGridPlaceholder(S.loadingPreviews);
        await yieldToMain();

        try {
            const tThumbs = perfDev() ? performance.now() : 0;
            const pageImages = printResult.pages.slice(0, MAX_PREVIEW_PAGES).map((svg) => svgToDataUrl(svg));
            if (perfDev()) {
                perfLog(
                    'preview thumbs (svgToDataUrl × N)',
                    performance.now() - tThumbs,
                    `${pageImages.length} thumbs — each encodes full sheet SVG`,
                );
            }
            const guideImage = printResult.guide ? svgToDataUrl(printResult.guide.svg) : null;
            const totalPages = printResult.totalPages;
            const truncated = totalPages > MAX_PREVIEW_PAGES;
            if (signal.aborted) {
                return;
            }

            byId('fullChartHint').classList.remove('hidden');

            trunc.classList.toggle('hidden', !truncated);
            if (truncated) {
                // Counts printed sheets, like the sheets stepper: the guide thumbnail is one of them.
                trunc.textContent = interpolate(S.truncatedPreview, {
                    shown: pageImages.length + (guideImage ? 1 : 0),
                    total: printedSheetCount(totalPages),
                });
            }
            thumbs.innerHTML = '';
            const layoutN = tiling.pageCount;
            // A single sheet is the whole chart, so it is shown at full-chart size without a page caption.
            const singlePage = totalPages <= 1;
            thumbs.classList.toggle('thumb-grid--single', singlePage);
            if (guideImage) {
                // The assembly guide prints first and is unnumbered.
                const wrap = document.createElement('div');
                wrap.className = 'thumb-wrap';
                const cap = document.createElement('p');
                cap.className = 'cap';
                cap.textContent = S.assemblyGuideLabel;
                const img = document.createElement('img');
                img.className = 'thumb-img';
                img.src = guideImage;
                img.alt = S.assemblyGuideLabel;
                img.style.border = '1px solid var(--border)';
                wrap.append(cap, img);
                thumbs.appendChild(wrap);
            }
            pageImages.forEach((src, i) => {
                const wrap = document.createElement('div');
                wrap.className = 'thumb-wrap';
                if (!singlePage) {
                    const cap = document.createElement('p');
                    cap.className = 'cap';
                    cap.textContent = interpolate(S.pageLabel, {n: i + 1});
                    wrap.appendChild(cap);
                }
                const img = document.createElement('img');
                img.className = 'thumb-img';
                img.src = src;
                img.alt = interpolate(S.pageLabel, {n: i + 1});
                if (layoutN > 1 && totalPages > 1) {
                    // Same palette as the full-chart blocks so each thumbnail matches its block's colour.
                    img.style.border = `2px solid ${charucoPagePreviewBorderColor(i + 1, layoutN, false)}`;
                } else {
                    img.style.border = '1px solid var(--border)';
                }
                wrap.appendChild(img);
                thumbs.appendChild(wrap);
            });
            await awaitPreviewImagesDecodedAndPaint(thumbs);
            if (signal.aborted || runId !== previewGeneration) {
                return;
            }
            if (perfDev()) {
                perfLog('runPreview JS through paint proxy', performance.now() - previewWallStart, '');
                if (scheduleBaselineMs !== undefined) {
                    perfLog(
                        'wall: schedulePreview → paint proxy',
                        performance.now() - scheduleBaselineMs,
                        `debounce target ${lastScheduledPreviewDelayMs}ms`,
                    );
                }
            }
            statusEl.textContent = '';
        } catch (e) {
            if ((e as Error).name === 'AbortError') {
                return;
            }
            statusEl.textContent = e instanceof Error ? e.message : String(e);
            resetPreviewVisualsEmpty();
        }
    } finally {
        endPreviewBusyIfCurrent();
    }
}

/** Print-shop preview: the one board, exactly the SVG the PDF is made from (page, bleed, marks and slug). */
async function runShopPreview(signal: AbortSignal, runId: number): Promise<void> {
    const statusEl = byId('previewStatus') as HTMLParagraphElement;
    const panelPreview = byId('panelPreview');
    const thumbs = byId('thumbGrid');
    byId('fullPreviewBlock').classList.add('hidden');
    byId('previewTruncated').classList.add('hidden');
    const layout = shopLayoutNow();
    if (!layout || !state.shopSizeId) {
        statusEl.textContent = '';
        resetPreviewVisualsEmpty();
        return;
    }
    panelPreview.setAttribute('aria-busy', 'true');
    statusEl.textContent = '';
    setThumbGridPlaceholder(S.loadingPreviews);
    await yieldToMain();
    try {
        const {renderShopPrintSvg} = await import('./print/shopSheet.js');
        const sheet = await renderShopPrintSvg({
            squaresX: state.squaresX,
            squaresY: state.squaresY,
            squareMm: state.squareMm,
            layout,
            size: {id: state.shopSizeId, unit: state.shopUnit},
            options: shopOptions(),
        });
        if (signal.aborted || runId !== previewGeneration) {
            return;
        }
        thumbs.innerHTML = '';
        thumbs.classList.add('thumb-grid--single');
        const wrap = document.createElement('div');
        wrap.className = 'thumb-wrap';
        const img = document.createElement('img');
        img.className = 'thumb-img';
        img.src = svgToDataUrl(sheet.svg);
        img.alt = shopSummaryText(layout);
        img.style.border = '1px solid var(--border)';
        wrap.appendChild(img);
        thumbs.appendChild(wrap);
        await awaitPreviewImagesDecodedAndPaint(thumbs);
    } catch (e) {
        if (runId === previewGeneration) {
            statusEl.textContent = e instanceof Error ? e.message : String(e);
            resetPreviewVisualsEmpty();
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

function exportBasenamePrefix(): string {
    if (state.mode === 'shop' && state.shopSizeId) {
        const parts = [
            'skellychart-printshop',
            state.shopSizeId,
            `${state.squaresX}x${state.squaresY}`,
            `${state.squareMm}mm`,
            bleedFileToken(bleedMmForUnit(state.shopBleed, state.shopUnit)),
            ...(state.shopCropMarks ? ['crop'] : []),
        ];
        return parts.join('-').replace(/[^\w.-]+/g, '_');
    }
    const parts = [
        'skellychart',
        state.paperId,
        `${state.squaresX}x${state.squaresY}`,
        `${state.squareMm}mm`,
    ];
    return parts.join('-').replace(/[^\w.-]+/g, '_');
}

/**
 * A shop board is printed once, at cost, and its QR must open the released generator: only release builds
 * whose QR targets skelly.cam make the file. Dev builds may, after confirming it is a test.
 */
function shopExportAllowed(): boolean {
    const v = parseChartVersion(APP_VERSION);
    const release = v !== null && v.prerelease === null && getCharucoPrintSourceUrl().startsWith('https://skelly.cam/c/');
    if (release) {
        return true;
    }
    if (import.meta.env.DEV) {
        return window.confirm(interpolate(S.shopTestBuildConfirm, {version: APP_VERSION}));
    }
    showErr(S.shopReleaseOnly);
    return false;
}

async function saveShopPdf(): Promise<void> {
    const layout = shopLayoutNow();
    if (!layout || !state.shopSizeId) {
        showErr(S.layoutCannotFit);
        return;
    }
    if (!shopExportAllowed()) {
        return;
    }
    pdfExportInProgress = true;
    const btnSave = byId('btnSavePdf') as HTMLButtonElement;
    btnSave.disabled = true;
    btnSave.classList.add('btn--busy');
    btnSave.textContent = S.preparingPdfExport;
    // Snapshot the board so control changes during the export cannot mismatch the file and its name.
    const board = {squaresX: state.squaresX, squaresY: state.squaresY, squareMm: state.squareMm};
    const size = {id: state.shopSizeId, unit: state.shopUnit};
    const options = shopOptions();
    const prefix = exportBasenamePrefix();
    await yieldToMain();
    try {
        const {renderShopPrintSvg, shopPdfProperties} = await import('./print/shopSheet.js');
        const sheet = await renderShopPrintSvg({...board, layout, size, options});
        const blob = await buildPdfBlobFromSvgPages(
            [{svg: sheet.svg, widthMm: sheet.mediaMm.w, heightMm: sheet.mediaMm.h}],
            undefined,
            {
                shop: {
                    trimBoxMm: sheet.trimBoxMm,
                    bleedBoxMm: sheet.bleedBoxMm,
                    ...shopPdfProperties({...board, layout, size, chartUrl: sheet.chartUrl}),
                },
            },
        );
        downloadBlob(blob, `${prefix}.pdf`);
    } catch (e) {
        showErr(e instanceof Error ? e.message : String(e));
    } finally {
        pdfExportInProgress = false;
        btnSave.classList.remove('btn--busy');
        btnSave.textContent = state.mode === 'shop' ? S.shopDownload : S.savePdfFiles;
        btnSave.disabled = !hasPrintableLayout();
    }
}

async function savePdfFile(): Promise<void> {
    if (pdfExportInProgress) {
        return;
    }
    showErr(null);
    if (state.mode === 'shop') {
        await saveShopPdf();
        return;
    }
    const tiling = effectiveTiling();
    if (!tiling) {
        showErr(S.layoutCannotFit);
        return;
    }
    pdfExportInProgress = true;
    const btnSave = byId('btnSavePdf') as HTMLButtonElement;
    const idleLabel = S.savePdfFiles;
    btnSave.disabled = true;
    btnSave.classList.add('btn--busy');
    btnSave.textContent = S.preparingPdfExport;

    // Snapshot the chart before yielding so slider/paper changes during the export cannot
    // produce a PDF that differs from the filename or the layout we measured.
    const paperId = state.paperId;
    const squareMm = state.squareMm;
    const gridX = state.squaresX;
    const gridY = state.squaresY;
    const prefix = exportBasenamePrefix();
    const pd = paperById(paperId) ?? PAPER_OPTIONS[0]!;
    const {paperWMm, paperHMm} = nominalPaperToPdfDimensionsMm(pd.wMm, pd.hMm, tiling);
    const px = gridX;
    const py = gridY;
    await yieldToMain();

    try {
        const pages = buildPageSpecs(px, py, tiling).pages;
        const {pages: svgs, guide} = await renderCharucoPrintSvg({
            paperId,
            squaresX: px,
            squaresY: py,
            squareLengthMm: squareMm,
            paperWMm,
            paperHMm,
            markerLengthRatio: CHARUCO_MARKER_LENGTH_RATIO,
            tiling,
            pages,
            // Keep the busy label/spinner alive while many sheets are assembled.
            cooperativeYield: true,
        });
        const blob = await buildPdfBlobFromSvgPages(
            [
                ...(guide ? [{svg: guide.svg, widthMm: guide.paperWMm, heightMm: guide.paperHMm}] : []),
                ...svgs.map((svg) => ({svg, widthMm: paperWMm, heightMm: paperHMm})),
            ],
            ({current, total}) => {
                btnSave.textContent = interpolate(S.preparingPdfPage, {current, total});
            },
        );
        downloadBlob(blob, `${prefix}.pdf`);
    } catch (e) {
        showErr(e instanceof Error ? e.message : String(e));
    } finally {
        pdfExportInProgress = false;
        btnSave.classList.remove('btn--busy');
        btnSave.textContent = idleLabel;
        const t = effectiveTiling();
        btnSave.disabled = !t || t.pageCount < 1;
    }
}

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
    document.body.appendChild(iframe);

    const printWin = iframe.contentWindow;
    const printDoc = iframe.contentDocument;
    if (!printWin || !printDoc) {
        iframe.remove();
        showErr(S.printInitFailed);
        return;
    }

    printDoc.open();
    printDoc.write(html);
    printDoc.close();

    let fallbackCleanup: number | undefined;
    const tearDown = (): void => {
        if (fallbackCleanup !== undefined) {
            window.clearTimeout(fallbackCleanup);
            fallbackCleanup = undefined;
        }
        if (iframe.isConnected) {
            iframe.remove();
        }
    };

    const invokePrint = (): void => {
        printWin.addEventListener('afterprint', tearDown, {once: true});
        fallbackCleanup = window.setTimeout(tearDown, 120_000);
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
    const tiling = effectiveTiling();
    if (!tiling) {
        showErr(S.layoutCannotFit);
        return;
    }
    const btnPdf = byId('btnPdf') as HTMLButtonElement;
    const idleLabel = S.printCharts;
    btnPdf.disabled = true;
    btnPdf.classList.add('btn--busy');
    btnPdf.textContent = S.preparingPrint;
    await yieldToMain();

    const pd = paperDims();
    const {paperWMm, paperHMm} = nominalPaperToPdfDimensionsMm(pd.wMm, pd.hMm, tiling);
    const {squaresX: px, squaresY: py} = state;
    const pages = buildPageSpecs(px, py, tiling).pages;
    try {
        const {pages: svgs, guide} = await renderCharucoPrintSvg({
            paperId: state.paperId,
            squaresX: px,
            squaresY: py,
            squareLengthMm: state.squareMm,
            paperWMm,
            paperHMm,
            markerLengthRatio: CHARUCO_MARKER_LENGTH_RATIO,
            tiling,
            pages,
            cooperativeYield: false,
        });
        const [pageWCss, pageHCss] = svgRootOuterSizeAttrs(paperWMm, paperHMm, state.paperId);
        const sheetsHtml = svgs
            .map((svg) => `<div class="sheet">${stripXmlDeclaration(svg)}</div>`)
            .join('');
        // The guide may be turned the other way from the chart sheets, so it prints on its own named page.
        let guideCss = '';
        let guideHtml = '';
        if (guide) {
            const [guideWCss, guideHCss] = svgRootOuterSizeAttrs(guide.paperWMm, guide.paperHMm, state.paperId);
            guideCss =
                `@page guide{size:${guideWCss} ${guideHCss};margin:0}` +
                `.sheet.sheet--guide{page:guide;width:${guideWCss};height:${guideHCss}}` +
                `.sheet--guide>svg{width:${guideWCss};height:${guideHCss}}`;
            guideHtml = `<div class="sheet sheet--guide">${stripXmlDeclaration(guide.svg)}</div>`;
        }
        const html =
            `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>` +
            `<title>ChArUco print</title><style>` +
            `@page{size:${pageWCss} ${pageHCss};margin:0}` +
            `*{box-sizing:border-box}` +
            `html,body{margin:0;padding:0}` +
            `.sheet{width:${pageWCss};height:${pageHCss};margin:0;` +
            `page-break-after:always;break-after:page;overflow:hidden}` +
            `.sheet:last-child{page-break-after:auto;break-after:auto}` +
            `.sheet>svg{display:block;width:${pageWCss};height:${pageHCss}}` +
            guideCss +
            `</style></head><body>${guideHtml}${sheetsHtml}</body></html>`;

        printHtmlDocumentInHiddenIframe(html);
    } catch (e) {
        showErr(e instanceof Error ? e.message : String(e));
    }

    btnPdf.classList.remove('btn--busy');
    btnPdf.textContent = idleLabel;
    const t = effectiveTiling();
    btnPdf.disabled = !t || t.pageCount < 1;
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

    const expectedCv2 = expectedCharucoCv2QueryValue(CHARUCO_MARKER_LENGTH_RATIO);
    if (parsed.cv2 !== null && parsed.cv2 !== expectedCv2) {
        warnings.push(
            interpolate(S.qrOpenCvMismatch, {
                theirs: parsed.cv2,
                ours: expectedCv2,
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
        if (parsed.paperId !== null && paperById(parsed.paperId)) {
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
        // A link is not a slider: pick the largest distance whose minimum this square length meets.
        state.distanceId = workingDistanceTierFromSquareLengthMm(state.squareMm);
        const snapped = snapSquareMm(state.squareMm, state.squaresX, state.squaresY, pd.wMm, pd.hMm);
        if (snapped !== null) {
            state.squareMm = snapped;
        }
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
    window.addEventListener('pointerup', finalizeRangeGestureIfNeeded, true);
    window.addEventListener('pointercancel', finalizeRangeGestureIfNeeded, true);

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
        state.distanceId = normalizeWorkingDistanceId((e.target as HTMLSelectElement).value);
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
        state.paperId = (e.target as HTMLSelectElement).value;
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
    wireRangeResponsiveUi(sqmmEl);
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
    wireRangeResponsiveUi(sxEl);
    sxEl.addEventListener('input', (e) => {
        state.autoGrid = false;
        forgetLinkSquare();
        clearTransientNotices();
        setGridSize('squaresX', Number((e.target as HTMLInputElement).value));
        scheduleSyncUi();
    });

    const syEl = byId('sy') as HTMLInputElement;
    wireRangeResponsiveUi(syEl);
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
                    distance: bandLabel(state.distanceId, shouldUseImperialWorkingDistanceUnits()),
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
            applyThemePreference(getStoredPreference(), () => schedulePreview());
            syncThemeToggle();
        });
    }
}

function boot(): void {
    (byId('brandLogo') as HTMLImageElement).src = freemocapLogoUrl;
    initTheme(() => schedulePreview());
    wireUi();
    if (import.meta.env.DEV) {
        initDevQrLinkTargetUi();
        initAdvancedFoldout();
    }
    applyQrQueryFromLocation();
    syncQrVersionBanner();
    syncUi();
    renderScanCard();
}

boot();
