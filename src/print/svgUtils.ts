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

/** US paper presets: outer SVG / print page dimensions use inches; layout math stays in mm. */
const SVG_PAGE_INCHES_IDS = new Set(['letter', 'tabloid']);

/** Convert mm → inch string for SVG/CSS (trims float noise from mm constants). */
export function mmToInchString(mm: number): string {
    const inch = mm / 25.4;
    return inch.toFixed(4).replace(/\.?0+$/, '');
}

/** `width` / `height` attribute values (with unit) for the root print `<svg>`. */
export function svgRootOuterSizeAttrs(paperWMm: number, paperHMm: number, paperId: string): [string, string] {
    if (SVG_PAGE_INCHES_IDS.has(paperId)) {
        return [`${mmToInchString(paperWMm)}in`, `${mmToInchString(paperHMm)}in`];
    }
    return [`${paperWMm}mm`, `${paperHMm}mm`];
}

export function svgRootOpen(viewBoxW: number, viewBoxH: number, widthAttr: string, heightAttr: string): string {
    // xMidYMin: avoid default vertical centering when viewBox vs mm aspect ratios differ slightly (rounding).
    const par = 'preserveAspectRatio="xMidYMin meet"';
    return (
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
        `viewBox="0 0 ${viewBoxW} ${viewBoxH}" width="${widthAttr}" height="${heightAttr}" ${par}>`
    );
}

export const SVG_ROOT_CLOSE = '</svg>';
