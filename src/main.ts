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
    computeEffectiveTiling,
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
import {buildPageSpecs, nominalPaperToPdfDimensionsMm} from './print/tiling.js';
import {perfDev, perfLog} from './print/perfDebug.js';
import {CHARUCO_MARKER_LENGTH_RATIO} from './print/constants.js';
import {MAX_PREVIEW_PAGES, PREVIEW_DEBOUNCE_MS, svgToDataUrl} from './ui/previewSvg.js';
import {yieldToMain} from './ui/yieldToMain.js';
import {
    applyThemePreference,
    getStoredPreference,
    initTheme,
    setStoredPreference,
    type ThemePreference,
} from './ui/theme.js';
import {bandLabel, distanceLabel, interpolate, paperLabel, S, sheetCountPhrase} from './ui/strings.js';

const PRESET_IDS = ['near', 'mid', 'far'] as const;

function initialBoard(): {paperId: string; squareMm: number; squaresX: number; squaresY: number} {
    const paperId = defaultPaperId();
    const paper = paperById(paperId) ?? PAPER_OPTIONS[0]!;
    const plan = resolveDistancePrintPlan('mid', paperId);
    const squareMm =
        maxSquareMmForGridAndPages(plan.squaresX, plan.squaresY, paper.wMm, paper.hMm, plan.targetPages) ?? 54;
    return {paperId, squareMm, squaresX: plan.squaresX, squaresY: plan.squaresY};
}

const defaultBoard = initialBoard();

interface AppState {
    distanceId: string;
    paperId: string;
    squareMm: number;
    squaresX: number;
    squaresY: number;
    autoGrid: boolean;
}

const state: AppState = {
    distanceId: 'mid',
    paperId: defaultBoard.paperId,
    squareMm: defaultBoard.squareMm,
    squaresX: defaultBoard.squaresX,
    squaresY: defaultBoard.squaresY,
    autoGrid: true,
};

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

function showFullPreviewPlaceholder(message: string): void {
    const ph = byId('fullPreviewPlaceholder');
    const img = byId('boardImg') as HTMLImageElement;
    ph.textContent = message;
    ph.classList.remove('hidden');
    ph.classList.add('preview-image-placeholder--busy');
    img.classList.add('board-img--hidden');
    img.removeAttribute('src');
    img.alt = '';
}

function setThumbGridPlaceholder(message: string): void {
    const thumbs = byId('thumbGrid');
    thumbs.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'thumb-grid-loading thumb-grid-loading--busy';
    p.textContent = message;
    thumbs.appendChild(p);
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

function effectiveTiling() {
    const pd = paperDims();
    return computeEffectiveTiling(
        state.squaresX,
        state.squaresY,
        state.squareMm,
        pd.wMm,
        pd.hMm,
        state.autoGrid,
        autoPlan().targetPages,
    );
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

function syncUi(): void {
    const t0 = perfDev() ? performance.now() : 0;
    applyAutoPreset();
    const imperial = shouldUseImperialWorkingDistanceUnits();
    const pd = paperDims();
    const tiling = effectiveTiling();

    byId('pageTitle').textContent = S.title;
    byId('intro').textContent = S.intro;
    byId('lbl-distance').textContent = S.workingDistance;
    byId('lbl-paper').textContent = S.paperSize;
    byId('lbl-advanced').textContent = S.advanced;
    byId('gridCaption').textContent = state.autoGrid ? S.autoGridCaption : S.customGridCaption;
    byId('lbl-square').textContent = interpolate(S.squareLengthHeading, {mm: state.squareMm});
    byId('lbl-pages').textContent = interpolate(S.numberOfPages, {n: pagesSliderDisplay(tiling)});
    byId('lbl-sx').textContent = interpolate(S.squaresInX, {n: state.squaresX});
    byId('lbl-sy').textContent = interpolate(S.squaresInY, {n: state.squaresY});
    byId('preview-title').textContent = S.previewTitle;
    byId('lbl-fullchart').textContent = S.fullChart;
    (byId('btnPdf') as HTMLButtonElement).textContent = S.downloadSvg;

    const frac = squareLengthTierBandEdgeFractions();
    const tierEl = byId('tierLabels');
    tierEl.innerHTML = '';
    const w1 = frac.nearMid * 100;
    const w2 = (frac.midFar - frac.nearMid) * 100;
    const s1 = document.createElement('span');
    s1.style.width = `${w1}%`;
    s1.style.color = 'var(--near)';
    s1.textContent = bandLabel('near', imperial);
    const s2 = document.createElement('span');
    s2.style.width = `${w2}%`;
    s2.style.color = 'var(--mid)';
    s2.textContent = bandLabel('mid', imperial);
    const s3 = document.createElement('span');
    s3.style.flex = '1';
    s3.style.color = 'var(--far)';
    s3.textContent = bandLabel('far', imperial);
    tierEl.append(s1, s2, s3);

    const p1 = frac.nearMid * 100;
    const p2 = frac.midFar * 100;
    (byId('tierBar') as HTMLDivElement).style.background = `linear-gradient(to right, var(--near) 0%, var(--near) ${p1}%, var(--mid) ${p1}%, var(--mid) ${p2}%, var(--far) ${p2}%, var(--far) 100%)`;

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
    distSel.innerHTML = '';
    for (const id of PRESET_IDS) {
        const o = document.createElement('option');
        o.value = id;
        o.textContent = distanceLabel(id, imperial);
        distSel.appendChild(o);
    }
    distSel.value = state.distanceId;

    const paperSel = byId('paper') as HTMLSelectElement;
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
    btnPdf.disabled = !tiling || tiling.pageCount < 1;

    syncThemeToggle();
    showErr(null);
    if (perfDev()) {
        const dt = performance.now() - t0;
        if (dt > 16) {
            perfLog('syncUi (before schedulePreview debounce)', dt, 'slider/distance/paper → full DOM refresh');
        }
    }
    schedulePreview();
}

function schedulePreview(): void {
    if (previewTimer) {
        clearTimeout(previewTimer);
    }
    const scheduleBaselineMs = perfDev() ? performance.now() : undefined;
    previewTimer = setTimeout(() => {
        previewTimer = null;
        void runPreview(scheduleBaselineMs);
    }, PREVIEW_DEBOUNCE_MS);
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

    const tiling = effectiveTiling();
    const statusEl = byId('previewStatus') as HTMLParagraphElement;
    const panelPreview = byId('panelPreview');
    const fullBlock = byId('fullPreviewBlock');
    const boardImg = byId('boardImg') as HTMLImageElement;
    const overlays = byId('sheetOverlays');
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
    fullBlock.classList.remove('hidden');
    showFullPreviewPlaceholder(S.buildingPreview);
    setThumbGridPlaceholder(S.buildingPreviews);
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

        const rects = computeCharucoPagePreviewRects(state.squaresX, state.squaresY, tiling, cW, cH);
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

        const pages = buildPageSpecs(state.squaresX, state.squaresY, tiling).pages;

        let printResult: Awaited<ReturnType<typeof renderCharucoPrintSvg>>;
        try {
            printResult = await renderCharucoPrintSvg({
                squaresX: state.squaresX,
                squaresY: state.squaresY,
                squareLengthMm: state.squareMm,
                paperWMm,
                paperHMm,
                markerLengthRatio: CHARUCO_MARKER_LENGTH_RATIO,
                tiling,
                pages,
                signal,
                cooperativeYield: false,
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

        setThumbGridPlaceholder(S.buildingPreviews);
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
                        `debounce target ${PREVIEW_DEBOUNCE_MS}ms`,
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

async function downloadSvg(): Promise<void> {
    showErr(null);
    const tiling = effectiveTiling();
    if (!tiling) {
        showErr(S.layoutCannotFit);
        return;
    }
    const btnPdf = byId('btnPdf') as HTMLButtonElement;
    const downloadLabel = S.downloadSvg;
    btnPdf.disabled = true;
    btnPdf.classList.add('btn--busy');
    btnPdf.textContent = S.generatingSvg;
    await yieldToMain();

    const baseStem = `charuco_${state.squaresX}x${state.squaresY}_${state.paperId}`;
    const pd = paperDims();
    const {paperWMm, paperHMm} = nominalPaperToPdfDimensionsMm(pd.wMm, pd.hMm, tiling);
    const pages = buildPageSpecs(state.squaresX, state.squaresY, tiling).pages;
    try {
        const {pages: svgs} = await renderCharucoPrintSvg({
            squaresX: state.squaresX,
            squaresY: state.squaresY,
            squareLengthMm: state.squareMm,
            paperWMm,
            paperHMm,
            markerLengthRatio: CHARUCO_MARKER_LENGTH_RATIO,
            tiling,
            pages,
            cooperativeYield: false,
        });
        for (let i = 0; i < svgs.length; i++) {
            const blob = new Blob([svgs[i]!], {type: 'image/svg+xml;charset=utf-8'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${baseStem}_page${i + 1}.svg`;
            a.click();
            URL.revokeObjectURL(url);
            await yieldToMain();
        }
    } catch (e) {
        showErr(e instanceof Error ? e.message : String(e));
    }

    btnPdf.classList.remove('btn--busy');
    btnPdf.textContent = downloadLabel;
    const t = effectiveTiling();
    btnPdf.disabled = !t || t.pageCount < 1;
}

function clampInt(n: number, lo: number, hi: number): number {
    return Math.round(Math.max(lo, Math.min(hi, n)));
}

function wireUi(): void {
    (byId('distance') as HTMLSelectElement).addEventListener('change', (e) => {
        state.distanceId = (e.target as HTMLSelectElement).value;
        state.autoGrid = true;
        syncUi();
    });

    (byId('paper') as HTMLSelectElement).addEventListener('change', (e) => {
        state.paperId = (e.target as HTMLSelectElement).value;
        state.autoGrid = true;
        syncUi();
    });

    (byId('sqmm') as HTMLInputElement).addEventListener('input', (e) => {
        state.autoGrid = false;
        const raw = Number((e.target as HTMLInputElement).value);
        const pd = paperDims();
        state.squareMm = snapSquareMm(raw, state.squaresX, state.squaresY, pd.wMm, pd.hMm);
        syncDistanceFromSquareIfManual();
        syncUi();
    });

    (byId('pages') as HTMLInputElement).addEventListener('input', (e) => {
        state.autoGrid = false;
        const raw = Math.round(Number((e.target as HTMLInputElement).value));
        const pd = paperDims();
        const n = nearestValidTargetPages(raw, state.squaresX, state.squaresY, pd.wMm, pd.hMm);
        const sq = maxSquareMmForGridAndPages(state.squaresX, state.squaresY, pd.wMm, pd.hMm, n);
        if (sq !== null) {
            state.squareMm = sq;
        }
        syncUi();
    });

    (byId('sx') as HTMLInputElement).addEventListener('input', (e) => {
        state.autoGrid = false;
        state.squaresX = clampInt(Number((e.target as HTMLInputElement).value), BOARD_GRID_MIN, BOARD_GRID_MAX);
        syncUi();
    });

    (byId('sy') as HTMLInputElement).addEventListener('input', (e) => {
        state.autoGrid = false;
        state.squaresY = clampInt(Number((e.target as HTMLInputElement).value), BOARD_GRID_MIN, BOARD_GRID_MAX);
        syncUi();
    });

    byId('btnPdf').addEventListener('click', () => void downloadSvg());

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
    syncUi();
}

boot();
