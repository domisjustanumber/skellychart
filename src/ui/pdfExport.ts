/**
 * Client-side PDF export for printed charts.
 *
 * The print path builds vector SVG sheets and hands them to the browser print dialog. Browsers do
 * not expose a way to choose that dialog's "Save as PDF" destination programmatically, so this
 * module converts each finished sheet into PDF vector drawing commands (svg2pdf.js on jsPDF) and
 * packs the pages into a PDF whose page boxes match the paper dimensions exactly.
 *
 * Converting the same SVG the print path uses keeps the download in step with the print output
 * (nested logo/QR SVGs, crops, seam labels) while staying vector like the browser's own print
 * engine: no rasterising or image compression, so export is fast and squares stay sharp at any zoom.
 * Text is set in the PDF standard Helvetica rather than the sheet's system UI font.
 */

import {yieldToMain} from './yieldToMain.js';

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

function parseSvgPage(svg: string): Element {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = doc.documentElement;
    if (root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) {
        throw new Error('Could not render a chart sheet for the PDF.');
    }
    return root;
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

    const [{jsPDF}, {svg2pdf}] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
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

        if (i > 0) {
            doc.addPage([page.widthMm, page.heightMm], pageOrientation(page.widthMm, page.heightMm));
        }
        // jsPDF units are mm, so the root SVG viewport maps straight onto the page box.
        await svg2pdf(parseSvgPage(page.svg), doc, {
            x: 0,
            y: 0,
            width: page.widthMm,
            height: page.heightMm,
        });
    }

    return doc.output('blob');
}
