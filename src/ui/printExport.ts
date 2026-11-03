/**
 * Print and Save: the print dialog (the sheets in a hidden iframe), the PDF download of a home chart or
 * a print-shop board, and the two buttons' busy and cancel states.
 */
import {APP_VERSION} from '../appVersion.js';
import {IS_DEV} from '../env.js';
import {printOrder, renderCharucoPrintSvg, type PrintedChart} from '../print/svgDocument.js';
import {paperById} from '../print/papers.js';
import {parseChartVersion} from '../print/chartVersion.js';
import {MM_PER_INCH, svgRootOuterSizeAttrs} from '../print/svgUtils.js';
import type {ShopSizeId} from '../print/charucoDocUrl.js';
import {bleedMmForUnit} from '../print/shopSizes.js';
import {resolveQrLinkSourceUrl} from '../print/qrLinkTarget.js';
import {buildPdfBlobFromSvgPages} from './pdfExport.js';
import {yieldToMain, yieldToMainUnlessAborted} from './yieldToMain.js';
import {hasPrintableLayout, shopLayoutNow, shopOptions, snapshotChart, state} from './appState.js';
import {byId, showErr} from './dom.js';
import {interpolate, S} from './strings.js';

/** Set while a PDF export runs; the Save button then cancels it instead of starting another. */
let pdfExportAbort: AbortController | null = null;

/** Whether {@link runBusy} has a job running on `btn`. */
function isBusy(btn: HTMLButtonElement): boolean {
    return btn.dataset.busy !== undefined;
}

/**
 * Print and Save are enabled when there is something to print. A busy button keeps its job's label; busy
 * Print stays disabled, while busy Save stays enabled because clicking it cancels the export.
 */
export function syncExportButtons(): void {
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
    const eighths = (bleedMm / MM_PER_INCH) * 8;
    return Math.abs(eighths - Math.round(eighths)) < 1e-6
        ? `bleed${+(bleedMm / MM_PER_INCH).toFixed(3)}in`
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
        const {renderShopPrintSvg, SHOP_CMYK_BY_RGB, shopPdfProperties} = await import('../print/shopSheet.js');
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

export async function savePdfFile(): Promise<void> {
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

export async function openPrintDialog(): Promise<void> {
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
