import QRCode from 'qrcode';

/**
 * Nested SVG of the QR code, in module units, sized to fill the caller's box.
 *
 * The dark modules are one filled path (a rectangle per horizontal run), not `node-qrcode`'s SVG: that
 * strokes each row as a 1-unit line, and renderers anti-alias every stroke edge on its own, which
 * leaves hairline white seams between rows on screen and in printed PDFs. A single path is filled as
 * one shape, so neighbouring modules meet without a gap. `sizePx` is unused (the code is vector) but
 * kept so callers state the size they place it at.
 */
export async function generateQrSvgFragment(url: string, _sizePx: number): Promise<string> {
    // Pin M (qrcode's default) so a library upgrade cannot silently shrink printed modules.
    const {modules} = QRCode.create(url, {errorCorrectionLevel: 'M'});
    const n = modules.size;
    let d = '';
    for (let y = 0; y < n; y++) {
        let x = 0;
        while (x < n) {
            if (!modules.get(y, x)) {
                x++;
                continue;
            }
            let end = x;
            while (end < n && modules.get(y, end)) {
                end++;
            }
            d += `M${x} ${y}h${end - x}v1h${x - end}z`;
            x = end;
        }
    }
    // No width/height: a nested <svg> already fills its parent, and svg2pdf (PDF export) reads
    // width="100%" as 100 user units, which shrinks the QR on the sheet.
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" preserveAspectRatio="xMidYMin meet">` +
        `<rect width="${n}" height="${n}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`
    );
}
