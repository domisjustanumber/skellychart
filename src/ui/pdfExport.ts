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
 * Sheets name Helvetica first, so svg2pdf draws the PDF standard Helvetica, the face the banner is
 * wrapped with (Print uses Helvetica or a same-width stand-in such as Arial).
 *
 * svg2pdf reads percentage width/height on nested `<svg>` elements as user units, so the sheet SVG
 * leaves nested sizes unset (see `qrSvg.ts`).
 */

import type {jsPDFOptions} from 'jspdf';
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

/** A page box in mm from the page's top-left corner. */
export interface PdfBoxMm {
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * Print-shop file: one font-free CMYK page with its trim and bleed boxes, and document properties for the
 * shop. Every colour the sheet draws must be in `cmykByRgb` (keyed by rounded `r,g,b`), or the export fails.
 */
export interface PdfShopOptions {
    trimBoxMm: PdfBoxMm;
    bleedBoxMm: PdfBoxMm;
    cmykByRgb: Readonly<Record<string, readonly [number, number, number, number]>>;
    title: string;
    subject: string;
    keywords: string;
    creator: string;
}

/** Largest page jsPDF writes (14400 pt); it clamps bigger pages with only a console warning. */
const PDF_PAGE_MAX_MM = (14400 * 25.4) / 72;

/** Elements that would put fonts or images in a print-shop PDF; its SVG draws text as paths. */
const SHOP_FORBIDDEN_ELEMENTS = 'text, tspan, textPath, foreignObject, image, use';

/**
 * Writes every colour svg2pdf sets as DeviceCMYK from the shop's table: all its colour calls go through
 * these three setters (gradients, patterns, images and opacity would bypass them, and the shop sheet has
 * none). A colour missing from the table throws, so nothing reaches the PDF as RGB or grey.
 */
function useShopCmyk(doc: Record<string, unknown>, cmykByRgb: PdfShopOptions['cmykByRgb']): void {
    for (const name of ['setFillColor', 'setDrawColor', 'setTextColor']) {
        const original = (doc[name] as (...channels: number[]) => unknown).bind(doc);
        doc[name] = (r: number, g: number, b: number) => {
            const key = [r, g, b].map((v) => Math.round(Number(v))).join(',');
            const cmyk = cmykByRgb[key];
            if (!cmyk) {
                throw new Error(`The print-shop sheet uses rgb(${key}), which has no CMYK value.`);
            }
            return original(...cmyk);
        };
    }
}

/** A box (mm, top-left origin) as PDF points with a bottom-left origin, on a page `pageHMm` tall. */
function pdfBoxPt(box: PdfBoxMm, pageHMm: number) {
    const k = 72 / 25.4;
    return {
        bottomLeftX: box.x * k,
        bottomLeftY: (pageHMm - box.y - box.h) * k,
        topRightX: (box.x + box.w) * k,
        topRightY: (pageHMm - box.y) * k,
    };
}

/**
 * Pack every sheet into a single PDF. The returned blob contains all pages, in print order. With
 * `options.shop`, the PDF is the print-shop file: exactly one page, no fonts, a TrimBox and BleedBox.
 * Aborting `options.signal` stops it between pages with an `AbortError`.
 */
export async function buildPdfBlobFromSvgPages(
    pages: readonly PdfSvgPage[],
    onProgress?: PdfExportProgressHandler,
    options?: {shop?: PdfShopOptions; signal?: AbortSignal},
): Promise<Blob> {
    const first = pages[0];
    if (!first) {
        throw new Error('No printable pages to export.');
    }
    const shop = options?.shop;
    const signal = options?.signal;
    if (shop && (pages.length !== 1 || first.widthMm > PDF_PAGE_MAX_MM || first.heightMm > PDF_PAGE_MAX_MM)) {
        throw new Error('A print-shop file is one page of at most 5080 mm.');
    }

    const [{jsPDF}, {svg2pdf}] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
    const doc = new jsPDF({
        unit: 'mm',
        format: [first.widthMm, first.heightMm],
        orientation: pageOrientation(first.widthMm, first.heightMm),
        compress: true,
        // Otherwise jsPDF writes all 14 standard fonts into every file, used or not; and each page would
        // start with grey (`0 G`, `0 g`) colours.
        ...(shop ? {putOnlyUsedFonts: true, strokeColor: '0 0 0 1 K', fillColor: '0 0 0 1 k'} : {}),
    } as jsPDFOptions);
    if (shop) {
        useShopCmyk(doc as unknown as Record<string, unknown>, shop.cmykByRgb);
    }
    // Ask PDF viewers to print at actual size rather than fit to the page (Acrobat and Chrome honour it).
    doc.viewerPreferences({PrintScaling: 'None'});

    for (let i = 0; i < pages.length; i++) {
        const page = pages[i]!;
        onProgress?.({current: i + 1, total: pages.length});
        await yieldToMain();
        signal?.throwIfAborted();

        if (i > 0) {
            doc.addPage([page.widthMm, page.heightMm], pageOrientation(page.widthMm, page.heightMm));
        }
        // jsPDF units are mm, so the root SVG viewport maps straight onto the page box.
        const root = parseSvgPage(page.svg);
        if (shop && root.querySelector(SHOP_FORBIDDEN_ELEMENTS)) {
            throw new Error('The print-shop sheet contains text or images; it must be paths only.');
        }
        await svg2pdf(root, doc, {
            x: 0,
            y: 0,
            width: page.widthMm,
            height: page.heightMm,
        });
    }

    if (shop) {
        const {pageContext} = doc.getCurrentPageInfo() as unknown as {
            pageContext: {trimBox: ReturnType<typeof pdfBoxPt> | null; bleedBox: ReturnType<typeof pdfBoxPt> | null};
        };
        pageContext.trimBox = pdfBoxPt(shop.trimBoxMm, first.heightMm);
        pageContext.bleedBox = pdfBoxPt(shop.bleedBoxMm, first.heightMm);
        doc.setDocumentProperties({
            title: shop.title,
            subject: shop.subject,
            keywords: shop.keywords,
            creator: shop.creator,
        });
    }

    signal?.throwIfAborted();
    return doc.output('blob');
}
