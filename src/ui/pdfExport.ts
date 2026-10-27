/**
 * Client-side PDF export for printed charts.
 *
 * The print path builds vector SVG sheets and hands them to the browser print dialog. Browsers do
 * not expose a way to choose that dialog's "Save as PDF" destination programmatically, so this
 * module rasterises each finished sheet at print resolution and packs the pages into a PDF whose
 * page boxes match the paper dimensions exactly.
 *
 * Rasterising (rather than re-drawing the sheets with a PDF library) keeps the download identical
 * to the print output: nested logo/QR SVGs, text baselines, crops, and seam labels all come from
 * the same SVG the print path uses.
 */

import {yieldToMain} from './yieldToMain.js';

const MM_PER_INCH = 25.4;
/** Print resolution for sheet rasters. 300 dpi is standard print quality. */
const PDF_RASTER_DPI = 300;
/**
 * Browsers (notably mobile Safari) cap canvas dimensions and total area. Stay under conservative
 * limits so large sheets still export: A3/Tabloid land around 240–250 dpi, which is still print
 * quality, while smaller sheets keep the full 300 dpi.
 */
const MAX_CANVAS_EDGE_PX = 4096;
const MAX_CANVAS_AREA_PX = 16_777_216;

export interface PdfSvgPage {
    /** Complete page SVG from {@link renderCharucoPrintSvg}. */
    svg: string;
    widthMm: number;
    heightMm: number;
}

export interface PdfExportProgress {
    current: number;
    total: number;
}

export type PdfExportProgressHandler = (progress: PdfExportProgress) => void;

function rasterDimensions(widthMm: number, heightMm: number): {widthPx: number; heightPx: number} {
    const pxPerMm = PDF_RASTER_DPI / MM_PER_INCH;
    const targetW = Math.max(1, Math.round(widthMm * pxPerMm));
    const targetH = Math.max(1, Math.round(heightMm * pxPerMm));
    const scale = Math.min(
        1,
        MAX_CANVAS_EDGE_PX / Math.max(targetW, targetH),
        Math.sqrt(MAX_CANVAS_AREA_PX / (targetW * targetH)),
    );
    return {
        widthPx: Math.max(1, Math.round(targetW * scale)),
        heightPx: Math.max(1, Math.round(targetH * scale)),
    };
}

/**
 * Root SVG width/height are physical units (mm/in) used by the browser print path. Pin them to
 * the raster pixel size so the SVG is rendered at full print resolution instead of its intrinsic
 * CSS-pixel size.
 */
function svgForRaster(svg: string, widthPx: number, heightPx: number): string {
    return svg.replace(/<svg\b[^>]*>/, (openTag) =>
        openTag
            .replace(/\swidth\s*=\s*(?:"[^"]*"|'[^']*')/i, '')
            .replace(/\sheight\s*=\s*(?:"[^"]*"|'[^']*')/i, '')
            .replace(/^<svg\b/i, `<svg width="${widthPx}" height="${heightPx}"`),
    );
}

function loadSvgImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Could not render a chart sheet for the PDF.'));
        image.src = url;
    });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(blob);
            } else {
                reject(new Error('Could not encode a chart sheet for the PDF.'));
            }
        }, 'image/png');
    });
}

async function rasterizePage(page: PdfSvgPage): Promise<{
    png: Uint8Array;
    widthMm: number;
    heightMm: number;
}> {
    const {widthPx, heightPx} = rasterDimensions(page.widthMm, page.heightMm);
    const url = URL.createObjectURL(
        new Blob([svgForRaster(page.svg, widthPx, heightPx)], {type: 'image/svg+xml'}),
    );
    const canvas = document.createElement('canvas');
    try {
        const image = await loadSvgImage(url);
        if (typeof image.decode === 'function') {
            await image.decode().catch(() => {});
        }

        canvas.width = widthPx;
        canvas.height = heightPx;
        const ctx = canvas.getContext('2d', {alpha: false});
        if (!ctx) {
            throw new Error('Could not create a canvas for the PDF export.');
        }
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, widthPx, heightPx);
        ctx.drawImage(image, 0, 0, widthPx, heightPx);

        const png = new Uint8Array(await (await canvasToPng(canvas)).arrayBuffer());
        return {png, widthMm: page.widthMm, heightMm: page.heightMm};
    } finally {
        URL.revokeObjectURL(url);
        // Release the large backing store before the next sheet is rasterised.
        canvas.width = 0;
        canvas.height = 0;
    }
}

function pageOrientation(widthMm: number, heightMm: number): 'portrait' | 'landscape' {
    return widthMm > heightMm ? 'landscape' : 'portrait';
}

/** Pack every sheet into a single PDF. The returned blob contains all pages, in print order. */
export async function buildPdfBlobFromSvgPages(
    pages: readonly PdfSvgPage[],
    onProgress?: PdfExportProgressHandler,
): Promise<Blob> {
    const first = pages[0];
    if (!first) {
        throw new Error('No printable pages to export.');
    }

    const {jsPDF} = await import('jspdf');
    const doc = new jsPDF({
        unit: 'mm',
        format: [first.widthMm, first.heightMm],
        orientation: pageOrientation(first.widthMm, first.heightMm),
        compress: true,
    });

    for (let i = 0; i < pages.length; i++) {
        const page = pages[i]!;
        onProgress?.({current: i + 1, total: pages.length});
        await yieldToMain();

        const {png, widthMm, heightMm} = await rasterizePage(page);
        if (i > 0) {
            doc.addPage([widthMm, heightMm], pageOrientation(widthMm, heightMm));
        }
        doc.addImage(png, 'PNG', 0, 0, widthMm, heightMm, undefined, 'FAST');
    }

    return doc.output('blob');
}
