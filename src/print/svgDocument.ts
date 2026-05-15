import freemocapLogoUrl from '../freemocapLogoUrl.js';
import {CHARUCO_PRINT_SOURCE_URL, PIXELS_PER_MM, QR_SIZE_MM, SKELLY_TOP_HEIGHT_MM} from './constants.js';
import {buildCharucoDocumentationUrl} from './charucoDocUrl.js';
import {generateQrSvgFragment} from './qrSvg.js';
import {renderCharucoPrintSvgCore} from './svgAssemblyCore.js';
import type {PrintSvgParams, PrintSvgResult} from './svgAssemblyTypes.js';
import {zipSvgPages} from './svgZip.js';
import {yieldToMain} from '../ui/yieldToMain.js';

export type {PrintSvgParams} from './svgAssemblyTypes.js';
export {buildCharucoDocumentationUrl} from './charucoDocUrl.js';

async function resolveLogoHref(): Promise<string | null> {
    if (typeof window !== 'undefined') {
        return freemocapLogoUrl;
    }
    const logoFile = typeof process !== 'undefined' ? process.env.CHARUCO_LOGO_FILE?.trim() : '';
    if (logoFile) {
        const {pathToFileURL} = await import(/* @vite-ignore */ 'node:url');
        return pathToFileURL(logoFile).href;
    }
    return null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = src;
    });
}

async function resolveLogoDimensions(ppm: number): Promise<{
    href: string | null;
    widthPx: number;
    heightPx: number;
}> {
    const href = await resolveLogoHref();
    if (!href) {
        return {href: null, widthPx: 0, heightPx: 0};
    }
    try {
        const img = await loadImage(href);
        const nh = Math.max(1, Math.round(SKELLY_TOP_HEIGHT_MM * ppm));
        const nw = Math.max(1, Math.round((img.naturalWidth * nh) / Math.max(1, img.naturalHeight)));
        return {href, widthPx: nw, heightPx: nh};
    } catch {
        return {href: null, widthPx: 0, heightPx: 0};
    }
}

export async function renderCharucoPrintSvg(params: PrintSvgParams): Promise<PrintSvgResult> {
    const ppm = PIXELS_PER_MM;
    const docUrl = buildCharucoDocumentationUrl(
        params.documentationSourceUrl ?? CHARUCO_PRINT_SOURCE_URL,
        params.squaresX,
        params.squaresY,
        params.squareLengthMm,
        params.markerLengthRatio,
    );
    const qrSizePx = Math.max(32, Math.round(QR_SIZE_MM * ppm));
    const qrSvgFragment = await generateQrSvgFragment(docUrl, qrSizePx);
    const logo = await resolveLogoDimensions(ppm);

    return renderCharucoPrintSvgCore({
        ...params,
        qrSvgFragment,
        logoHref: logo.href,
        logoWidthPx: logo.widthPx,
        logoHeightPx: logo.heightPx,
    });
}

/** ZIP archive of per-page SVG files (download / baked preset). */
export async function renderCharucoPrintSvgZip(params: PrintSvgParams): Promise<Blob> {
    const {pages} = await renderCharucoPrintSvg(params);
    params.signal?.throwIfAborted();
    await yieldToMain();
    return zipSvgPages(pages);
}
