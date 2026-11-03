/**
 * The origin banner drawn from its layout (`originBannerLayout.ts`): logo, instructions, chart info and
 * QR. Home sheets and the assembly guide draw the full banner; print-shop boards draw the compact one
 * with outlined text.
 */
import {APP_VERSION_DISPLAY} from '../appVersion.js';
import {PIXELS_PER_MM} from './constants.js';
import {pdfLabels} from './labels.js';
import {layoutOriginBanner, type OriginBannerLayout, type OriginBannerLayoutParams} from './originBannerLayout.js';
import {SKELLY_LOGO_VIEWBOX_H, SKELLY_LOGO_VIEWBOX_W} from './skellyLogo.js';
import {capTopToBaseline, FONT, type SvgTextEmitter} from './svgPrimitives.js';
import {escapeXml} from './svgUtils.js';

/** The chart and artwork a home banner is drawn from; its layout depends only on these and the sheet. */
export interface OriginBannerInputs {
    squaresX: number;
    squaresY: number;
    squareLengthMm: number;
    /** Inner logo markup; `null` when the logo did not load, which leaves its box empty. */
    logoSvgInner: string | null;
    qrSvgFragment: string;
}

function svgTextBlock(lines: string[], x: number, yStart: number, lineLead: number, fontPx: number, bold = false): string {
    const weight = bold ? ' font-weight="bold"' : '';
    const tspans: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const inner = line === '' ? '&#xa0;' : escapeXml(line);
        if (i === 0) {
            tspans.push(`<tspan>${inner}</tspan>`);
        } else {
            tspans.push(`<tspan x="${x}" dy="${lineLead}">${inner}</tspan>`);
        }
    }
    return `<text x="${x}" y="${capTopToBaseline(yStart, fontPx)}" fill="#000" font-size="${fontPx}" font-family="${FONT}"${weight}>${tspans.join('')}</text>`;
}

/**
 * One right-aligned `<text>`: bold title line + body pieces placed by `layoutOriginBanner`, then the
 * write-in box for the measured square length. With `emitText`, each line is drawn by it instead.
 */
function svgCharucoBoardInfoBlock(b: OriginBannerLayout, emitText?: SvgTextEmitter): string {
    const {boardInfoRight: x, bannerTextTop: yStart, boardTitle, titleFontPx, boardInfoLines, bodyFontPx, writeInBox} = b;
    const sw = Math.max(1, Math.round(0.25 * PIXELS_PER_MM));
    const box = `<rect x="${writeInBox.x + sw / 2}" y="${writeInBox.y + sw / 2}" width="${writeInBox.w - sw}" height="${writeInBox.h - sw}" fill="#fff" stroke="#000" stroke-width="${sw}"/>`;
    if (emitText) {
        const title = emitText(boardTitle, {x, y: yStart, fontPx: titleFontPx, bold: true, anchor: 'end', baseline: 'hanging'});
        const body = boardInfoLines.map(({text, right, y}) =>
            emitText(text, {x: right, y, fontPx: bodyFontPx, anchor: 'end', baseline: 'hanging'}),
        );
        return title + body.join('') + box;
    }
    const bodyTspans = boardInfoLines.map(({text, right, y}) => {
        const inner = text === '' ? '&#xa0;' : escapeXml(text);
        return `<tspan x="${right}" y="${capTopToBaseline(y, bodyFontPx)}" font-size="${bodyFontPx}" font-weight="normal">${inner}</tspan>`;
    });
    return `<text x="${x}" y="${capTopToBaseline(yStart, titleFontPx)}" fill="#000" font-size="${titleFontPx}" font-family="${FONT}" text-anchor="end"><tspan font-weight="bold">${escapeXml(boardTitle)}</tspan>${bodyTspans.join('')}</text>${box}`;
}

/**
 * A laid-out banner's SVG parts. The full banner's instructions are `<text>`; `emitText` (print-shop
 * outlines) draws the chart info, and the compact banner it is used with has no instructions.
 */
export function svgOriginBannerParts(
    b: OriginBannerLayout,
    art: {logoSvgInner: string | null; qrSvgFragment: string},
    emitText?: SvgTextEmitter,
): string[] {
    const parts = [svgCharucoBoardInfoBlock(b, emitText)];
    if (art.logoSvgInner) {
        parts.push(
            `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" x="${b.bannerLeft}" y="${b.bannerTitleTop}" width="${b.logoWidthPx}" height="${b.logoHeightPx}" viewBox="0 0 ${SKELLY_LOGO_VIEWBOX_W} ${SKELLY_LOGO_VIEWBOX_H}" preserveAspectRatio="xMidYMin meet" overflow="hidden">${art.logoSvgInner}</svg>`,
        );
    }
    if (b.instLines.length > 0) {
        parts.push(
            svgTextBlock([pdfLabels.originInstructionsTitle], b.instrLeft, b.bannerTextTop, b.bodyLineLead, b.titleFontPx, true),
            svgTextBlock(b.instLines, b.instrLeft, b.instBodyY, b.bodyLineLead, b.bodyFontPx),
        );
    }
    parts.push(
        `<svg x="${b.qrX}" y="${b.bannerTitleTop}" width="${b.qrSizePx}" height="${b.qrSizePx}" overflow="hidden">${art.qrSvgFragment}</svg>`,
    );
    return parts;
}

/**
 * The full origin banner on a home sheet `sheetWMm` × `sheetHMm`, with the measuring line for a
 * single-sheet chart or the assembly guide, inside the sheet's safe margins or `box`; `bottom` includes
 * the gap below it.
 */
export function originBannerSvg(
    inputs: OriginBannerInputs,
    sheetWMm: number,
    sheetHMm: number,
    instructions: 'chart' | 'guide',
    box?: OriginBannerLayoutParams['box'],
): {parts: string[]; bottom: number} {
    const b = layoutOriginBanner({
        instructions,
        box,
        paperWMm: sheetWMm,
        paperHMm: sheetHMm,
        version: APP_VERSION_DISPLAY,
        squareLengthMm: inputs.squareLengthMm,
        squaresX: inputs.squaresX,
        squaresY: inputs.squaresY,
    });
    return {parts: svgOriginBannerParts(b, inputs), bottom: b.bottom};
}
