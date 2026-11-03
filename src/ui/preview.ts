/**
 * The preview panel: debounced thumbnails of the sheets as printed (the guide first), the print-shop
 * board as the PDF draws it, and the chart to scale in the scale scene.
 */
import {IS_DEV} from '../env.js';
import {renderCharucoPrintSvg} from '../print/svgDocument.js';
import {svgAssembledChartWithSheetNumbers} from '../print/assemblyGuideSvg.js';
import {sheetColorRgb} from '../print/charucoLayout.js';
import {printedSheetCount} from '../print/tiling.js';
import {perfLog} from '../print/perfDebug.js';
import {PIXELS_PER_MM} from '../print/constants.js';
import {rgbCss} from '../print/svgUtils.js';
import {mountScaleScene} from './scaleScene.js';
import {yieldToMain, yieldToMainUnlessAborted} from './yieldToMain.js';
import {IMPERIAL, shopLayoutNow, shopOptions, snapshotChart, state} from './appState.js';
import {byId} from './dom.js';
import {shopSummaryText} from './shopControls.js';
import {interpolate, S} from './strings.js';

const MAX_PREVIEW_PAGES = 5;
/** Debounce after the user stops manipulating ranges (keyboard / one-off changes). */
export const PREVIEW_DEBOUNCE_IDLE_MS = 320;
/** Tighter debounce while a range input pointer is active so previews keep up while dragging. */
const PREVIEW_DEBOUNCE_INTERACTIVE_MS = 96;

function svgToDataUrl(svg: string): string {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** The chart to scale in front of two people; mounted by {@link mountPreviewScaleScene}. */
let scaleScene: ReturnType<typeof mountScaleScene> | null = null;

/** Mounts the scale scene; called once in boot. */
export function mountPreviewScaleScene(): void {
    scaleScene = mountScaleScene(byId('scaleScene'), IMPERIAL);
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

let previewTimer: ReturnType<typeof setTimeout> | null = null;
/** The running preview's; a new run aborts it, so a stale run sees its signal aborted. */
let previewAbort: AbortController | null = null;

export function schedulePreview(delayOverride: number | undefined, pointerGestureHeld: boolean): void {
    if (previewTimer) {
        clearTimeout(previewTimer);
    }
    const scheduleBaselineMs = IS_DEV ? performance.now() : undefined;
    const delayMs =
        delayOverride !== undefined
            ? delayOverride
            : pointerGestureHeld
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
        const {renderShopPrintSvg} = await import('../print/shopSheet.js');
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
