import freemocapLogoUrl from '../freemocapLogoUrl.js';
import {resolveQrLinkSourceUrl} from './qrLinkTarget.js';
import {buildCharucoDocumentationUrl} from './charucoDocUrl.js';
import {generateQrSvgFragment} from './qrSvg.js';
import {perfAsync} from './perfDebug.js';
import {renderCharucoPrintSvgCore} from './svgAssemblyCore.js';
import type {PrintedChart, PrintSvgOptions, PrintSvgResult} from './svgAssemblyTypes.js';

export type {PrintedChart} from './svgAssemblyTypes.js';

/** The logo's inner markup, loaded once per runtime (browser tab or Node process). */
let memoLogoSvgInner: Promise<string | null> | undefined;

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

/** The logo file's XML: fetched in a browser, read from `CHARUCO_LOGO_FILE` under Node (the build checks). */
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

/**
 * Inline logo markup (nested `<svg>`) so exported charts open in Inkscape; a top-level `<image
 * href="data:image/svg+xml,...">` is often shown as broken there, and `xlink:href` on `<image>` is
 * still what many SVG 1.1 tools expect for external images. `null` when the logo did not load; the banner
 * draws it in `BANNER_LOGO_PX`. Never rejects.
 */
export function resolveLogoForPrint(): Promise<string | null> {
    memoLogoSvgInner ??= fetchFreemocapLogoSvgXmlOnce().then((xml) =>
        xml ? stripEmbeddedPngImages(stripOuterSvgWrapper(xml)) || null : null,
    );
    return memoLogoSvgInner;
}

export async function renderCharucoPrintSvg(chart: PrintedChart, options: PrintSvgOptions = {}): Promise<PrintSvgResult> {
    const docUrl = buildCharucoDocumentationUrl(
        resolveQrLinkSourceUrl(),
        chart.squaresX,
        chart.squaresY,
        chart.squareMm,
        {kind: 'home', paperId: chart.paperId, banner: chart.banner},
    );
    const qrSvgFragment = generateQrSvgFragment(docUrl);
    const logoSvgInner = await perfAsync('Logo SVG inner fragment (cached after first fetch)', () => resolveLogoForPrint());

    return perfAsync('renderCharucoPrintSvgCore (board + all sheets)', () =>
        renderCharucoPrintSvgCore({
            ...options,
            chart,
            qrSvgFragment,
            chartUrl: docUrl,
            logoSvgInner,
        }),
    );
}

/** Every page of a render in print order: the assembly guide (multi-sheet charts), then the chart sheets. */
export function printOrder(r: PrintSvgResult): string[] {
    return [...(r.guide ? [r.guide] : []), ...r.sheets];
}

if (typeof window !== 'undefined') {
    queueMicrotask(() => void resolveLogoForPrint());
}
