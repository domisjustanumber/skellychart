import freemocapLogoUrl from './freemocapLogoUrl.js';
import {renderCharucoBoardSvg} from './charuco/board.js';
import {renderCharucoPrintSvg} from './print/svgDocument.js';
import {
    BOARD_GRID_MAX,
    BOARD_GRID_MIN,
    CHARUCO_SQUARE_MM_MAX,
    CHARUCO_SQUARE_MM_MIN,
    PAGE_COUNT_MAX,
    PAGE_COUNT_MIN,
    PAPER_OPTIONS,
    paperById,
    charucoPagePreviewBorderColor,
    computeCharucoPagePreviewRects,
    computeEffectivePrintLayout,
    defaultPaperId,
    layoutSummaryText,
    maxSquareMmForGridAndPages,
    nearestValidTargetPages,
    resolveDistancePrintPlan,
    shouldUseImperialWorkingDistanceUnits,
    snapSquareMm,
    squareLengthTierBandEdgeFractions,
    validTargetPageCountsForGrid,
    workingDistanceTierFromSquareLengthMm,
} from './print/charucoLayout.js';
import {ensureTilingFeasibilityForPaperId} from './print/tilingFeasibilityTables.js';
import {buildPageSpecs, nominalPaperToPdfDimensionsMm} from './print/tiling.js';
import {perfDev, perfLog} from './print/perfDebug.js';
import {CHARUCO_MARKER_LENGTH_RATIO, CHARUCO_PRINT_LABEL_SPEC_VERSION} from './print/constants.js';
import {expectedCharucoCv2QueryValue, parseCharucoQrSearchParams} from './print/charucoDocUrl.js';
import {
    MAX_PREVIEW_PAGES,
    PREVIEW_DEBOUNCE_IDLE_MS,
    PREVIEW_DEBOUNCE_INTERACTIVE_MS,
    svgToDataUrl,
} from './ui/previewSvg.js';
import {yieldToMain} from './ui/yieldToMain.js';
import {
    applyThemePreference,
    getStoredPreference,
    initTheme,
    setStoredPreference,
    type ThemePreference,
} from './ui/theme.js';
import {bandLabel, distanceSelectLabel, interpolate, paperLabel, S, sheetCountPhrase} from './ui/strings.js';

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

function byId(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) {
        throw new Error(`Missing #${id}`);
    }
    return el;
}

function hideFullPreviewPlaceholder(): void {
    const ph = byId('fullPreviewPlaceholder');
    ph.textContent = '';
    ph.classList.add('hidden');
    ph.classList.remove('preview-image-placeholder--busy');
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

function showFullPreviewPlaceholder(message: string): void {
    const ph = byId('fullPreviewPlaceholder');
    const img = byId('boardImg') as HTMLImageElement;
    setPreviewBusyMarkup(ph, message);
    ph.classList.remove('hidden');
    ph.classList.add('preview-image-placeholder--busy');
    img.classList.add('board-img--hidden');
    img.removeAttribute('src');
    img.alt = '';
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
    hideFullPreviewPlaceholder();
    const img = byId('boardImg') as HTMLImageElement;
    img.classList.add('board-img--hidden');
    img.removeAttribute('src');
    img.alt = '';
    byId('sheetOverlays').innerHTML = '';
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
    const plan = autoPlan();
    const pd = paperDims();
    const maxSq = maxSquareMmForGridAndPages(plan.squaresX, plan.squaresY, pd.wMm, pd.hMm, plan.targetPages);
    if (maxSq !== null) {
        state.squaresX = plan.squaresX;
        state.squaresY = plan.squaresY;
        state.squareMm = maxSq;
    }
}

function effectivePrintLayout() {
    const pd = paperDims();
    return computeEffectivePrintLayout(
        state.squaresX,
        state.squaresY,
        state.squareMm,
        pd.wMm,
        pd.hMm,
        state.autoGrid,
        autoPlan().targetPages,
    );
}

function effectiveTiling() {
    return effectivePrintLayout()?.tiling ?? null;
}

/** Grid dimensions passed to {@link buildPageSpecs} / {@link renderCharucoPrintSvg} when the pattern is transposed for tiling. */
function printSquareDims(patternRotated90: boolean): {squaresX: number; squaresY: number} {
    return patternRotated90
        ? {squaresX: state.squaresY, squaresY: state.squaresX}
        : {squaresX: state.squaresX, squaresY: state.squaresY};
}

function pagesSliderDisplay(tiling: ReturnType<typeof effectiveTiling>): number {
    return state.autoGrid ? autoPlan().targetPages : tiling?.pageCount ?? 1;
}

function syncDistanceFromSquareIfManual(): void {
    if (state.autoGrid) {
        return;
    }
    const tier = workingDistanceTierFromSquareLengthMm(state.squareMm);
    if ((PRESET_IDS as readonly string[]).includes(tier)) {
        state.distanceId = tier;
    }
}

function isDarkMode(): boolean {
    return document.documentElement.dataset.theme === 'dark';
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
    const pd = paperDims();
    const tiling = effectiveTiling();

    if (!lite) {
        byId('pageTitle').textContent = S.title;
        byId('intro').textContent = S.intro;
        byId('lbl-distance').textContent = S.workingDistance;
        byId('lbl-paper').textContent = S.paperSize;
        byId('lbl-advanced').textContent = S.advanced;
    }
    byId('lbl-square').textContent = interpolate(S.squareLengthHeading, {mm: state.squareMm});
    byId('lbl-pages').textContent = interpolate(S.numberOfPages, {n: pagesSliderDisplay(tiling)});
    byId('lbl-sx').textContent = interpolate(S.squaresInX, {n: state.squaresX});
    byId('lbl-sy').textContent = interpolate(S.squaresInY, {n: state.squaresY});
    if (!lite) {
        byId('preview-title').textContent = S.previewTitle;
        byId('lbl-fullchart').textContent = S.fullChart;
        (byId('btnPdf') as HTMLButtonElement).textContent = S.printCharts;
        (byId('btnSaveSvg') as HTMLButtonElement).textContent = S.saveSvgFiles;
        byId('printScaleHint').textContent = S.printScaleHint;
    }

    const frac = squareLengthTierBandEdgeFractions();
    const pCloseEnd = frac.closeNear * 100;
    const pNearEnd = frac.nearFar * 100;
    const tierBandKey = `${imperial}:${pCloseEnd}:${pNearEnd}`;
    const tierBar = byId('tierBar') as HTMLDivElement;
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
        tierBar.style.background =
            `linear-gradient(to right, var(--close) 0%, var(--close) ${pCloseEnd}%, var(--near) ${pCloseEnd}%, var(--near) ${pNearEnd}%, var(--far) ${pNearEnd}%, var(--far) 100%)`;
    }

    const sqmm = byId('sqmm') as HTMLInputElement;
    sqmm.min = String(CHARUCO_SQUARE_MM_MIN);
    sqmm.max = String(CHARUCO_SQUARE_MM_MAX);
    sqmm.step = '1';
    sqmm.value = String(state.squareMm);

    const pages = byId('pages') as HTMLInputElement;
    pages.min = String(PAGE_COUNT_MIN);
    pages.max = String(PAGE_COUNT_MAX);
    pages.step = '1';
    pages.value = String(Math.round(pagesSliderDisplay(tiling)));
    const manualTargets = validTargetPageCountsForGrid(state.squaresX, state.squaresY, pd.wMm, pd.hMm);
    pages.disabled = !state.autoGrid && manualTargets.length === 0;

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
                wMm: p.wMm,
                hMm: p.hMm,
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
        sheetCountPhrase,
        (cols, rows) => interpolate('; {{cols}}×{{rows}} sheet grid', {cols, rows}),
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
    const btnSaveSvg = byId('btnSaveSvg') as HTMLButtonElement;
    const exportDisabled = !tiling || tiling.pageCount < 1;
    btnPdf.disabled = exportDisabled;
    btnSaveSvg.disabled = exportDisabled;

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

function flushPreviewImgLayoutReads(boardImg: HTMLImageElement, thumbsRoot: HTMLElement): void {
    void boardImg.offsetWidth;
    for (const img of thumbsRoot.querySelectorAll<HTMLImageElement>('img.thumb-img')) {
        void img.offsetWidth;
    }
}

/**
 * After assigning SVG data URLs to `<img>`, the slow part is often **paint/composite**, which
 * happens *after* `decode()` resolves. We still `decode()` (readiness), force layout reads, then
 * wait **2× requestAnimationFrame** as a rough proxy for “about to paint”.
 */
async function awaitPreviewImagesDecodedAndPaint(boardImg: HTMLImageElement, thumbsRoot: HTMLElement): Promise<void> {
    const tDecode = perfDev() ? performance.now() : 0;
    const pending: Promise<void>[] = [
        boardImg.decode().catch(() => {}),
        ...Array.from(thumbsRoot.querySelectorAll<HTMLImageElement>('img.thumb-img'), (im) =>
            im.decode().catch(() => {}),
        ),
    ];
    await Promise.all(pending);
    if (perfDev()) {
        perfLog('browser <img> decode()', performance.now() - tDecode, `${pending.length} images`);
    }

    flushPreviewImgLayoutReads(boardImg, thumbsRoot);

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

    const layout = effectivePrintLayout();
    const tiling = layout?.tiling ?? null;
    const statusEl = byId('previewStatus') as HTMLParagraphElement;
    const panelPreview = byId('panelPreview');
    const fullBlock = byId('fullPreviewBlock');
    const boardImg = byId('boardImg') as HTMLImageElement;
    const overlays = byId('sheetOverlays');
    const thumbs = byId('thumbGrid');
    const trunc = byId('previewTruncated');

    if (!layout || !tiling || tiling.pageCount < 1) {
        statusEl.textContent = '';
        panelPreview.setAttribute('aria-busy', 'false');
        fullBlock.classList.add('hidden');
        resetPreviewVisualsEmpty();
        trunc.classList.add('hidden');
        return;
    }

    panelPreview.setAttribute('aria-busy', 'true');
    statusEl.textContent = '';
    fullBlock.classList.remove('hidden');
    showFullPreviewPlaceholder(S.loadingPreview);
    setThumbGridPlaceholder(S.loadingPreviews);
    byId('sheetOverlays').innerHTML = '';
    await yieldToMain();

    try {
        const previewWallStart = perfDev() ? performance.now() : 0;

        const markerMm = state.squareMm * CHARUCO_MARKER_LENGTH_RATIO;
        const maxEdge = 560;
        const wMm = state.squaresX * state.squareMm;
        const hMm = state.squaresY * state.squareMm;
        let cW: number;
        let cH: number;
        if (wMm >= hMm) {
            cW = Math.min(maxEdge, Math.max(32, Math.round(wMm)));
            cH = Math.max(1, Math.round(cW * (hMm / wMm)));
        } else {
            cH = Math.min(maxEdge, Math.max(32, Math.round(hMm)));
            cW = Math.max(1, Math.round(cH * (wMm / hMm)));
        }

        const rects = computeCharucoPagePreviewRects(
            state.squaresX,
            state.squaresY,
            tiling,
            cW,
            cH,
            layout.patternRotated90,
        );
        const dark = isDarkMode();

        await yieldToMain();
        if (signal.aborted) {
            return;
        }

        const tBoardSvg = perfDev() ? performance.now() : 0;
        const boardDataUrl = svgToDataUrl(
            renderCharucoBoardSvg(cW, cH, {
                squaresX: state.squaresX,
                squaresY: state.squaresY,
                squareLength: state.squareMm,
                markerLength: markerMm,
            }),
        );
        if (perfDev()) {
            perfLog('live board (renderCharucoBoardSvg + data URL)', performance.now() - tBoardSvg, `${cW}×${cH}px`);
        }

        await yieldToMain();
        if (signal.aborted) {
            return;
        }

        const pd = paperDims();
        const {paperWMm, paperHMm} = nominalPaperToPdfDimensionsMm(pd.wMm, pd.hMm, tiling);

        const {squaresX: px, squaresY: py} = printSquareDims(layout.patternRotated90);
        const pages = buildPageSpecs(px, py, tiling).pages;

        let printResult: Awaited<ReturnType<typeof renderCharucoPrintSvg>>;
        try {
            printResult = await renderCharucoPrintSvg({
                squaresX: px,
                squaresY: py,
                squareLengthMm: state.squareMm,
                paperWMm,
                paperHMm,
                markerLengthRatio: CHARUCO_MARKER_LENGTH_RATIO,
                tiling,
                pages,
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
            const totalPages = printResult.totalPages;
            const truncated = totalPages > MAX_PREVIEW_PAGES;
            if (signal.aborted) {
                return;
            }

            hideFullPreviewPlaceholder();
            boardImg.src = boardDataUrl;
            boardImg.alt = S.fullChart;
            boardImg.classList.remove('board-img--hidden');

            overlays.innerHTML = '';
            if (rects) {
                for (const r of rects) {
                    const d = document.createElement('div');
                    d.className = 'sheet-rect';
                    d.style.left = `${r.left * 100}%`;
                    d.style.top = `${r.top * 100}%`;
                    d.style.width = `${r.width * 100}%`;
                    d.style.height = `${r.height * 100}%`;
                    d.style.borderColor = charucoPagePreviewBorderColor(r.sheetIndex, tiling.pageCount, dark);
                    overlays.appendChild(d);
                }
            }

            trunc.classList.toggle('hidden', !truncated);
            if (truncated) {
                trunc.textContent = interpolate(S.truncatedPreview, {
                    shown: pageImages.length,
                    total: totalPages,
                });
            }
            thumbs.innerHTML = '';
            if (totalPages > 1) {
                const hdr = document.createElement('p');
                hdr.className = 'caption';
                hdr.textContent = interpolate(S.pageCountLabel, {count: totalPages});
                hdr.style.gridColumn = '1 / -1';
                thumbs.appendChild(hdr);
            }
            const layoutN = tiling.pageCount;
            pageImages.forEach((src, i) => {
                const wrap = document.createElement('div');
                wrap.className = 'thumb-wrap';
                const cap = document.createElement('p');
                cap.className = 'cap';
                cap.textContent = interpolate(S.pageLabel, {n: i + 1});
                const img = document.createElement('img');
                img.className = 'thumb-img';
                img.src = src;
                img.alt = interpolate(S.pageLabel, {n: i + 1});
                if (layoutN > 1 && totalPages > 1) {
                    img.style.border = `2px solid ${charucoPagePreviewBorderColor(i + 1, layoutN, dark)}`;
                } else {
                    img.style.border = '1px solid var(--border)';
                }
                wrap.append(cap, img);
                thumbs.appendChild(wrap);
            });
            await awaitPreviewImagesDecodedAndPaint(boardImg, thumbs);
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

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Trigger a file download from string contents (UTF-8 SVG). */
function downloadSvgString(content: string, filename: string): void {
    const blob = new Blob([content], {type: 'image/svg+xml;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function exportSvgBasenamePrefix(): string {
    const parts = [
        'skellychart',
        state.paperId,
        `${state.squaresX}x${state.squaresY}`,
        `${state.squareMm}mm`,
    ];
    return parts.join('-').replace(/[^\w.-]+/g, '_');
}

async function saveSvgFiles(): Promise<void> {
    showErr(null);
    const layout = effectivePrintLayout();
    const tiling = layout?.tiling ?? null;
    if (!tiling || !layout) {
        showErr(S.layoutCannotFit);
        return;
    }
    const btnSave = byId('btnSaveSvg') as HTMLButtonElement;
    const idleLabel = S.saveSvgFiles;
    btnSave.disabled = true;
    btnSave.classList.add('btn--busy');
    btnSave.textContent = S.preparingSvgExport;
    await yieldToMain();

    const pd = paperDims();
    const {paperWMm, paperHMm} = nominalPaperToPdfDimensionsMm(pd.wMm, pd.hMm, tiling);
    const {squaresX: px, squaresY: py} = printSquareDims(layout.patternRotated90);
    const pages = buildPageSpecs(px, py, tiling).pages;
    try {
        const {pages: svgs} = await renderCharucoPrintSvg({
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
        const prefix = exportSvgBasenamePrefix();
        const staggerMs = 120;
        for (let i = 0; i < svgs.length; i++) {
            if (i > 0) {
                await delay(staggerMs);
            }
            const n = i + 1;
            downloadSvgString(svgs[i]!, `${prefix}-${n}-of-${svgs.length}.svg`);
        }
    } catch (e) {
        showErr(e instanceof Error ? e.message : String(e));
    }

    btnSave.classList.remove('btn--busy');
    btnSave.textContent = idleLabel;
    const t = effectiveTiling();
    btnSave.disabled = !t || t.pageCount < 1;
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
    const layout = effectivePrintLayout();
    const tiling = layout?.tiling ?? null;
    if (!tiling || !layout) {
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
    const {squaresX: px, squaresY: py} = printSquareDims(layout.patternRotated90);
    const pages = buildPageSpecs(px, py, tiling).pages;
    try {
        const {pages: svgs} = await renderCharucoPrintSvg({
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
        const sheetsHtml = svgs
            .map((svg) => `<div class="sheet">${stripXmlDeclaration(svg)}</div>`)
            .join('');
        const html =
            `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>` +
            `<title>Charuco print</title><style>` +
            `@page{size:${paperWMm}mm ${paperHMm}mm;margin:0}` +
            `*{box-sizing:border-box}` +
            `html,body{margin:0;padding:0}` +
            `.sheet{width:${paperWMm}mm;height:${paperHMm}mm;margin:0;` +
            `page-break-after:always;break-after:page;overflow:hidden}` +
            `.sheet:last-child{page-break-after:auto;break-after:auto}` +
            `.sheet>svg{display:block;width:${paperWMm}mm;height:${paperHMm}mm}` +
            `</style></head><body>${sheetsHtml}</body></html>`;

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

    if (parsed.labelSpecVersion !== null && parsed.labelSpecVersion !== CHARUCO_PRINT_LABEL_SPEC_VERSION) {
        warnings.push(
            interpolate(S.qrChartSpecMismatch, {
                theirs: parsed.labelSpecVersion,
                ours: CHARUCO_PRINT_LABEL_SPEC_VERSION,
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
        const pd = paperDims();
        if (parsed.squareLengthMm !== null) {
            state.squareMm = Math.round(parsed.squareLengthMm);
        }
        state.squareMm = snapSquareMm(state.squareMm, state.squaresX, state.squaresY, pd.wMm, pd.hMm);
        syncDistanceFromSquareIfManual();
    }

    qrVersionBannerMessage = warnings.length ? warnings.join(' ') : null;
}

function syncQrVersionBanner(): void {
    const el = byId('qrVersionBanner');
    if (qrVersionBannerMessage) {
        el.textContent = qrVersionBannerMessage;
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
        state.autoGrid = true;
        syncUi();
        void ensureTilingFeasibilityForPaperId(state.paperId).then(() => syncUi({lite: true}));
    });

    const sqmmEl = byId('sqmm') as HTMLInputElement;
    wireRangeResponsiveUi(sqmmEl);
    sqmmEl.addEventListener('input', (e) => {
        state.autoGrid = false;
        const raw = Number((e.target as HTMLInputElement).value);
        const pd = paperDims();
        state.squareMm = snapSquareMm(raw, state.squaresX, state.squaresY, pd.wMm, pd.hMm);
        syncDistanceFromSquareIfManual();
        scheduleSyncUi();
    });

    const pagesEl = byId('pages') as HTMLInputElement;
    wireRangeResponsiveUi(pagesEl);
    pagesEl.addEventListener('input', (e) => {
        state.autoGrid = false;
        const raw = Math.round(Number((e.target as HTMLInputElement).value));
        const pd = paperDims();
        const n = nearestValidTargetPages(raw, state.squaresX, state.squaresY, pd.wMm, pd.hMm);
        const sq = maxSquareMmForGridAndPages(state.squaresX, state.squaresY, pd.wMm, pd.hMm, n);
        if (sq !== null) {
            state.squareMm = sq;
        }
        scheduleSyncUi();
    });

    const sxEl = byId('sx') as HTMLInputElement;
    wireRangeResponsiveUi(sxEl);
    sxEl.addEventListener('input', (e) => {
        state.autoGrid = false;
        state.squaresX = clampInt(Number((e.target as HTMLInputElement).value), BOARD_GRID_MIN, BOARD_GRID_MAX);
        scheduleSyncUi();
    });

    const syEl = byId('sy') as HTMLInputElement;
    wireRangeResponsiveUi(syEl);
    syEl.addEventListener('input', (e) => {
        state.autoGrid = false;
        state.squaresY = clampInt(Number((e.target as HTMLInputElement).value), BOARD_GRID_MIN, BOARD_GRID_MAX);
        scheduleSyncUi();
    });

    byId('btnPdf').addEventListener('click', () => void openPrintDialog());
    byId('btnSaveSvg').addEventListener('click', () => void saveSvgFiles());

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
    applyQrQueryFromLocation();
    syncQrVersionBanner();
    syncUi();
    void ensureTilingFeasibilityForPaperId(state.paperId).then(() => syncUi({lite: true}));
}

boot();
