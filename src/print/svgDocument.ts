import freemocapLogoUrl from '../freemocapLogoUrl.js';
import {getCharucoPrintSourceUrl} from './constants.js';
import {buildCharucoDocumentationUrl} from './charucoDocUrl.js';
import {BANNER_QR_PX} from './originBannerLayout.js';
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
 * still what many SVG 1.1 tools expect for external images. `null` when the logo did not load; the banner
 * draws it in `BANNER_LOGO_PX`.
 */
export async function resolveLogoForPrint(): Promise<string | null> {
    const xml = await loadFreemocapLogoSvgXml();
    if (!xml) {
        return null;
    }
    if (memoLogoSvgInner === undefined) {
        memoLogoSvgInner = logoInnerMarkupFromXml(xml);
    }
    return memoLogoSvgInner || null;
}

export async function renderCharucoPrintSvg(params: PrintSvgParams): Promise<PrintSvgResult> {
    const docUrl = buildCharucoDocumentationUrl(
        params.documentationSourceUrl ?? getCharucoPrintSourceUrl(),
        params.squaresX,
        params.squaresY,
        params.squareLengthMm,
        params.paperId,
    );
    const qrSvgFragment = await perfAsync('QR SVG fragment', () => generateQrSvgFragment(docUrl, BANNER_QR_PX));
    const logoSvgInner = await perfAsync('Logo SVG inner fragment (cached after first fetch)', () => resolveLogoForPrint());

    return perfAsync('renderCharucoPrintSvgCore (board + all sheets)', () =>
        renderCharucoPrintSvgCore({
            ...params,
            qrSvgFragment,
            chartUrl: docUrl,
            logoSvgInner,
        }),
    );
}

if (typeof window !== 'undefined') {
    queueMicrotask(() => warmupFreemocapLogoCache());
}
