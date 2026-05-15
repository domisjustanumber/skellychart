import freemocapLogoUrl from '../freemocapLogoUrl.js';
import {getCharucoPrintSourceUrl, PIXELS_PER_MM, QR_SIZE_MM, SKELLY_TOP_HEIGHT_MM} from './constants.js';
import {buildCharucoDocumentationUrl} from './charucoDocUrl.js';
import {SKELLY_LOGO_NATURAL_W_OVER_H} from './originBannerEstimate.js';
import {generateQrSvgFragment} from './qrSvg.js';
import {perfAsync} from './perfDebug.js';
import {renderCharucoPrintSvgCore} from './svgAssemblyCore.js';
import type {PrintSvgParams, PrintSvgResult} from './svgAssemblyTypes.js';

export type {PrintSvgParams} from './svgAssemblyTypes.js';
export {buildCharucoDocumentationUrl} from './charucoDocUrl.js';

/** One resolved XML fetch/read per runtime (browser tab or Node process). */
let memoLogoXmlPromise: Promise<string | null> | undefined;

/** Inner fragment (no wrapper) after first successful parse — reused for every print SVG. */
let memoLogoSvgInner: string | undefined;

function stripOuterSvgWrapper(svgXml: string): string {
    const t = svgXml.trim().replace(/^<\?xml[\s\S]*?\?>/, '').trimStart();
    const m = t.match(/<svg\b[\s\S]*?>([\s\S]*)<\/svg>\s*$/i);
    return m?.[1]?.trim() ?? t;
}

/**
 * Embedded `<image xlink:href="*.png">` from Illustrator export — files are not shipped; drop so
 * Inkscape does not show missing-image tiles when editing the chart.
 */
function stripEmbeddedPngImages(svgInner: string): string {
    return svgInner.replace(
        /<image\b[\s\S]*?(?:xlink:href|href)\s*=\s*["'][^"']*\.png["'][\s\S]*?(?:\/>|>[\s\S]*?<\/image>)/gi,
        '',
    );
}

function logoInnerMarkupFromXml(xml: string): string {
    return stripEmbeddedPngImages(stripOuterSvgWrapper(xml));
}

async function fetchFreemocapLogoSvgXmlOnce(): Promise<string | null> {
    try {
        if (typeof window !== 'undefined') {
            const url = new URL(freemocapLogoUrl, window.location.href).href;
            const res = await fetch(url, {cache: 'force-cache'});
            if (!res.ok) {
                return null;
            }
            return await res.text();
        }
        const logoFile = typeof process !== 'undefined' ? process.env.CHARUCO_LOGO_FILE?.trim() : '';
        if (!logoFile) {
            return null;
        }
        const {readFileSync} = await import(/* @vite-ignore */ 'node:fs');
        return readFileSync(logoFile, 'utf8');
    } catch {
        return null;
    }
}

async function loadFreemocapLogoSvgXml(): Promise<string | null> {
    memoLogoXmlPromise ??= fetchFreemocapLogoSvgXmlOnce();
    return memoLogoXmlPromise;
}

function warmupFreemocapLogoCache(): void {
    void loadFreemocapLogoSvgXml().catch(() => {});
}

/**
 * Inline logo markup (nested `<svg>`) so exported charts open in Inkscape; a top-level `<image
 * href="data:image/svg+xml,...">` is often shown as broken there, and `xlink:href` on `<image>` is
 * still what many SVG 1.1 tools expect for external images.
 */
async function resolveLogoForPrint(ppm: number): Promise<{
    logoSvgInner: string | null;
    widthPx: number;
    heightPx: number;
}> {
    const xml = await loadFreemocapLogoSvgXml();
    if (!xml) {
        return {logoSvgInner: null, widthPx: 0, heightPx: 0};
    }
    if (memoLogoSvgInner === undefined) {
        memoLogoSvgInner = logoInnerMarkupFromXml(xml);
    }
    const nh = Math.max(1, Math.round(SKELLY_TOP_HEIGHT_MM * ppm));
    const nw = Math.max(1, Math.round(SKELLY_LOGO_NATURAL_W_OVER_H * nh));
    return {logoSvgInner: memoLogoSvgInner || null, widthPx: nw, heightPx: nh};
}

export async function renderCharucoPrintSvg(params: PrintSvgParams): Promise<PrintSvgResult> {
    const ppm = PIXELS_PER_MM;
    const docUrl = buildCharucoDocumentationUrl(
        params.documentationSourceUrl ?? getCharucoPrintSourceUrl(),
        params.squaresX,
        params.squaresY,
        params.squareLengthMm,
        params.markerLengthRatio,
    );
    const qrSizePx = Math.max(32, Math.round(QR_SIZE_MM * ppm));
    const qrSvgFragment = await perfAsync('QR SVG fragment', () => generateQrSvgFragment(docUrl, qrSizePx));
    const logo = await perfAsync('Logo SVG inner fragment (cached after first fetch)', () => resolveLogoForPrint(ppm));

    return perfAsync('renderCharucoPrintSvgCore (board + all sheets)', () =>
        renderCharucoPrintSvgCore({
            ...params,
            qrSvgFragment,
            logoSvgInner: logo.logoSvgInner,
            logoWidthPx: logo.widthPx,
            logoHeightPx: logo.heightPx,
        }),
    );
}

if (typeof window !== 'undefined') {
    queueMicrotask(() => warmupFreemocapLogoCache());
}
