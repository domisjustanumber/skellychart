import QRCode from 'qrcode';

/** Inner SVG fragment (paths) for embedding in a sheet, sized to `sizePx`. */
export async function generateQrSvgFragment(url: string, sizePx: number): Promise<string> {
    const raw = await QRCode.toString(url, {
        type: 'svg',
        margin: 0,
        width: Math.max(32, Math.round(sizePx)),
    });
    const inner = raw.replace(/^\s*<\?xml[^>]*>\s*/i, '').replace(/^\s*<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
    return inner.trim();
}
