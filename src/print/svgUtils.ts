export function escapeXml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function rgbCss(rgb: [number, number, number]): string {
    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

export function svgRootOpen(
    viewBoxW: number,
    viewBoxH: number,
    widthMm: number,
    heightMm: number,
): string {
    // xMidYMin: avoid default vertical centering when viewBox vs mm aspect ratios differ slightly (rounding).
    const par = 'preserveAspectRatio="xMidYMin meet"';
    return (
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
        `viewBox="0 0 ${viewBoxW} ${viewBoxH}" width="${widthMm}mm" height="${heightMm}mm" ${par}>`
    );
}

export const SVG_ROOT_CLOSE = '</svg>';
