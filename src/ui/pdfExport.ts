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
 * Known svg2pdf gaps the sheets work around:
 * - `dominant-baseline` is ignored, so {@link normaliseTextBaselines} rewrites it as explicit y
 *   offsets measured in the browser font, matching where print places each line.
 * - Percentage width/height on nested `<svg>` elements is read as user units, so the sheet SVG
 *   leaves nested sizes unset (see `qrSvg.ts`).
 */

import {yieldToMain} from './yieldToMain.js';

/** Canvas font size used to measure baseline offsets as fractions of an em. */
const BASELINE_MEASURE_PX = 100;

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

/** Distance (in em) from the alphabetic baseline down to where the browser draws `baseline`. */
function baselineShiftEm(
    ctx: CanvasRenderingContext2D,
    baseline: string,
    fontFamily: string,
    fontWeight: string,
): number {
    ctx.font = `${fontWeight} ${BASELINE_MEASURE_PX}px ${fontFamily}`;
    const m = ctx.measureText('H');
    switch (baseline) {
        case 'hanging':
            return (m.hangingBaseline ?? 0.8 * m.fontBoundingBoxAscent) / BASELINE_MEASURE_PX;
        case 'middle':
            return ctx.measureText('x').actualBoundingBoxAscent / 2 / BASELINE_MEASURE_PX;
        case 'ideographic':
            return -m.fontBoundingBoxDescent / BASELINE_MEASURE_PX;
        default:
            return 0;
    }
}

function numAttr(el: Element, name: string, fallback: number): number {
    const v = parseFloat(el.getAttribute(name) ?? '');
    return Number.isFinite(v) ? v : fallback;
}

/**
 * svg2pdf draws every line on its alphabetic baseline. Move each `dominant-baseline` text down by
 * the browser's own offset for that baseline so lines land where print puts them; tspans with a
 * different font size get the difference as extra `dy`.
 */
function normaliseTextBaselines(root: Element): void {
    const texts = Array.from(root.querySelectorAll('text[dominant-baseline]'));
    const ctx = texts.length > 0 ? document.createElement('canvas').getContext('2d') : null;
    if (!ctx) {
        return;
    }
    for (const text of texts) {
        const em = baselineShiftEm(
            ctx,
            text.getAttribute('dominant-baseline') ?? '',
            text.getAttribute('font-family') ?? 'sans-serif',
            text.getAttribute('font-weight') ?? '',
        );
        const textSize = numAttr(text, 'font-size', 16);
        text.setAttribute('y', String(numAttr(text, 'y', 0) + em * textSize));
        let prevSize = textSize;
        for (const tspan of Array.from(text.querySelectorAll('tspan'))) {
            const size = numAttr(tspan, 'font-size', textSize);
            if (tspan.hasAttribute('y')) {
                tspan.setAttribute('y', String(numAttr(tspan, 'y', 0) + em * size));
            } else if (size !== prevSize) {
                tspan.setAttribute('dy', String(numAttr(tspan, 'dy', 0) + em * (size - prevSize)));
            }
            prevSize = size;
        }
        text.removeAttribute('dominant-baseline');
    }
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

/** Print-shop file: one font-free page with its trim and bleed boxes, and document properties for the shop. */
export interface PdfShopOptions {
    trimBoxMm: PdfBoxMm;
    bleedBoxMm: PdfBoxMm;
    title: string;
    subject: string;
    keywords: string;
    creator: string;
}

/** Largest page jsPDF writes (14400 pt); it clamps bigger pages with only a console warning. */
const PDF_PAGE_MAX_MM = (14400 * 25.4) / 72;

/** Elements that would put fonts or images in a print-shop PDF; its SVG draws text as paths. */
const SHOP_FORBIDDEN_ELEMENTS = 'text, tspan, textPath, foreignObject, image, use';

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
 */
export async function buildPdfBlobFromSvgPages(
    pages: readonly PdfSvgPage[],
    onProgress?: PdfExportProgressHandler,
    options?: {shop?: PdfShopOptions},
): Promise<Blob> {
    const first = pages[0];
    if (!first) {
        throw new Error('No printable pages to export.');
    }
    const shop = options?.shop;
    if (shop && (pages.length !== 1 || first.widthMm > PDF_PAGE_MAX_MM || first.heightMm > PDF_PAGE_MAX_MM)) {
        throw new Error('A print-shop file is one page of at most 5080 mm.');
    }

    const [{jsPDF}, {svg2pdf}] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
    const doc = new jsPDF({
        unit: 'mm',
        format: [first.widthMm, first.heightMm],
        orientation: pageOrientation(first.widthMm, first.heightMm),
        compress: true,
        // Otherwise jsPDF writes all 14 standard fonts into every file, used or not.
        ...(shop ? {putOnlyUsedFonts: true} : {}),
    });
    // Ask PDF viewers to print at actual size rather than fit to the page (Acrobat and Chrome honour it).
    doc.viewerPreferences({PrintScaling: 'None'});

    for (let i = 0; i < pages.length; i++) {
        const page = pages[i]!;
        onProgress?.({current: i + 1, total: pages.length});
        await yieldToMain();

        if (i > 0) {
            doc.addPage([page.widthMm, page.heightMm], pageOrientation(page.widthMm, page.heightMm));
        }
        // jsPDF units are mm, so the root SVG viewport maps straight onto the page box.
        const root = parseSvgPage(page.svg);
        if (shop && root.querySelector(SHOP_FORBIDDEN_ELEMENTS)) {
            throw new Error('The print-shop sheet contains text or images; it must be paths only.');
        }
        normaliseTextBaselines(root);
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

    return doc.output('blob');
}
