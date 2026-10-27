import QRCode from 'qrcode';

function extractSvgViewBox(svgXml: string): string | null {
    const m = svgXml.match(/viewBox\s*=\s*(["'])([^"']*)\1/i);
    const v = m?.[2]?.trim();
    return v && v.length > 0 ? v : null;
}

/**
 * Nested SVG sized to fill the caller’s box. `node-qrcode` emits paths in module space (small
 * viewBox) while setting width/height to the pixel size — wrapping with viewBox=`0 0 ${width}`
 * shrinks the graphic unless we preserve qrcode’s viewBox on an inner svg.
 */
export async function generateQrSvgFragment(url: string, sizePx: number): Promise<string> {
    const px = Math.max(32, Math.round(sizePx));
    const raw = await QRCode.toString(url, {
        type: 'svg',
        margin: 0,
        width: px,
        // Pin M (qrcode's default) so a library upgrade cannot silently shrink printed modules.
        errorCorrectionLevel: 'M',
    });
    const inner = raw.replace(/^\s*<\?xml[^>]*>\s*/i, '').replace(/^\s*<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
    const viewBox = extractSvgViewBox(raw) ?? `0 0 ${px} ${px}`;
    // No width/height: a nested <svg> already fills its parent, and svg2pdf (PDF export) reads
    // width="100%" as 100 user units, which shrinks the QR on the sheet.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMin meet" shape-rendering="crispEdges">${inner.trim()}</svg>`;
}
