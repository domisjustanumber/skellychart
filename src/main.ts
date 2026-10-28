import {APP_VERSION} from './appVersion.js';
import freemocapLogoUrl from './freemocapLogoUrl.js';
import {renderCharucoPrintSvg} from './print/svgDocument.js';
import {svgAssembledChartWithSheetNumbers} from './print/svgAssemblyCore.js';
import {
    BOARD_GRID_MAX,
    BOARD_GRID_MIN,
    CHARUCO_SQUARE_MM_MAX,
    CHARUCO_SQUARE_MM_MIN,
    PAPER_OPTIONS,
    paperById,
    charucoPagePreviewBorderColor,
    computeEffectivePrintLayout,
    defaultPaperId,
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
import {CHARUCO_MARKER_LENGTH_RATIO, getCharucoPrintSourceUrlFor} from './print/constants.js';
import {compareChartVersions, parseChartVersion} from './print/chartVersion.js';
import {svgRootOuterSizeAttrs} from './print/svgUtils.js';
import {
    buildCharucoDocumentationUrl,
    expectedCharucoCv2QueryValue,
    mergeCharucoQrParamsInto,
    parseCharucoQrSearchParams,
} from './print/charucoDocUrl.js';
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
import {mountScaleScene} from './ui/scaleScene.js';
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
    paperId: string;
    squareMm: number;
    squaresX: number;
    squaresY: number;
    autoGrid: boolean;
}

const state: AppState = {
    distanceId: DEFAULT_WORKING_DISTANCE_ID,
    paperId: defaultBoard.paperId,
    squareMm: defaultBoard.squareMm,
    squaresX: defaultBoard.squaresX,
    squaresY: defaultBoard.squaresY,
    autoGrid: true,
};

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
    scaleScene?.update(null);
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
 * prints every square length up to the paper's limit, so there is nothing to snap or end-stop here.
 */
function setGridSize(axis: 'squaresX' | 'squaresY', requested: number): void {
    state[axis] = clampInt(requested, BOARD_GRID_MIN, BOARD_GRID_MAX);
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
    mergeCharucoQrParamsInto(u.searchParams, squaresX, squaresY, state.squareMm, state.paperId);
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
        const linkTarget = link.dataset.qrTarget === 'local' ? 'local' : 'production';
        const url = buildCharucoDocumentationUrl(
            getCharucoPrintSourceUrlFor(linkTarget),
            squaresX,
            squaresY,
            state.squareMm,
            state.paperId,
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
    byId('lbl-square').textContent = interpolate(S.squareLengthHeading, {mm: state.squareMm});
    byId('lbl-sx').textContent = interpolate(S.squaresInX, {n: state.squaresX});
    byId('lbl-sy').textContent = interpolate(S.squaresInY, {n: state.squaresY});
    if (!lite) {
        byId('print-save-heading').textContent = S.printSave;
        byId('preview-title').textContent = S.previewTitle;
        byId('fullChartHint').textContent = S.fullChartHint;
        (byId('btnPdf') as HTMLButtonElement).textContent = S.printCharts;
        if (!pdfExportInProgress) {
            (byId('btnSavePdf') as HTMLButtonElement).textContent = S.savePdfFiles;
        }
        setPrintAdviceElement(byId('printAdvice'));
    }

    const frac = squareLengthTierBandEdgeFractions();
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
    sqmm.max = String(CHARUCO_SQUARE_MM_MAX);
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

    const summary = layoutSummaryText(
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
    const exportDisabled = !tiling || tiling.pageCount < 1;
    btnPdf.disabled = exportDisabled;
    btnSavePdf.disabled = exportDisabled || pdfExportInProgress;

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
            // A single sheet is shown as printed; several as the assembled chart with its sheet numbers.
            const sceneChart =
                totalPages <= 1
                    ? {href: pageImages[0]!, widthMm: paperWMm, heightMm: paperHMm, isSheet: true}
                    : {
                          href: svgToDataUrl(
                              svgAssembledChartWithSheetNumbers(px, py, state.squareMm, CHARUCO_MARKER_LENGTH_RATIO, tiling),
                          ),
                          widthMm: px * state.squareMm,
                          heightMm: py * state.squareMm,
                          isSheet: false,
                      };
            const truncated = totalPages > MAX_PREVIEW_PAGES;
            if (signal.aborted) {
                return;
            }

            byId('fullChartHint').classList.remove('hidden');
            scaleScene?.update(sceneChart);

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
            // A single sheet is the whole chart, so it has no page caption.
            const singlePage = totalPages <= 1;
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

function exportBasenamePrefix(): string {
    const parts = [
        'skellychart',
        state.paperId,
        `${state.squaresX}x${state.squaresY}`,
        `${state.squareMm}mm`,
    ];
    return parts.join('-').replace(/[^\w.-]+/g, '_');
}

async function savePdfFile(): Promise<void> {
    if (pdfExportInProgress) {
        return;
    }
    showErr(null);
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
        state.autoGrid = false;
        if (parsed.squaresX !== null) {
            state.squaresX = clampInt(parsed.squaresX, BOARD_GRID_MIN, BOARD_GRID_MAX);
        }
        if (parsed.squaresY !== null) {
            state.squaresY = clampInt(parsed.squaresY, BOARD_GRID_MIN, BOARD_GRID_MAX);
        }
        if (parsed.paperId !== null && paperById(parsed.paperId)) {
            state.paperId = parsed.paperId;
        }
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
        const raw = Number((e.target as HTMLInputElement).value);
        const pd = paperDims();
        const snapped = snapSquareMm(raw, state.squaresX, state.squaresY, pd.wMm, pd.hMm);
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
        setGridSize('squaresX', Number((e.target as HTMLInputElement).value));
        scheduleSyncUi();
    });

    const syEl = byId('sy') as HTMLInputElement;
    wireRangeResponsiveUi(syEl);
    syEl.addEventListener('input', (e) => {
        state.autoGrid = false;
        forgetLinkSquare();
        setGridSize('squaresY', Number((e.target as HTMLInputElement).value));
        scheduleSyncUi();
    });

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
    scaleScene = mountScaleScene(byId('scaleScene'), shouldUseImperialWorkingDistanceUnits);
    wireUi();
    if (import.meta.env.DEV) {
        initDevQrLinkTargetUi();
        initAdvancedFoldout();
    }
    applyQrQueryFromLocation();
    syncQrVersionBanner();
    syncUi();
}

boot();
