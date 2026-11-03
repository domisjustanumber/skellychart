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
import {type SvgTextEmitter, svgTextLines} from './svgPrimitives.js';

/** The chart and artwork a home banner is drawn from; its layout depends only on these and the sheet. */
export interface OriginBannerInputs {
    squaresX: number;
    squaresY: number;
    squareLengthMm: number;
    /** Inner logo markup; `null` when the logo did not load, which leaves its box empty. */
    logoSvgInner: string | null;
    qrSvgFragment: string;
}

/**
 * A laid-out banner's SVG parts: the right-aligned chart info (bold title, then the body pieces placed by
 * `layoutOriginBanner` and the write-in box for the measured square length), logo, instructions and QR.
 * With `emitText` (print-shop outlines), each line of text is drawn by it.
 */
export function svgOriginBannerParts(
    b: OriginBannerLayout,
    art: {logoSvgInner: string | null; qrSvgFragment: string},
    emitText?: SvgTextEmitter,
): string[] {
    const {titleFontPx, bodyFontPx, writeInBox} = b;
    const sw = Math.max(1, Math.round(0.25 * PIXELS_PER_MM));
    const parts = [
        svgTextLines([{text: b.boardTitle, x: b.boardInfoRight, y: b.bannerTextTop}], {fontPx: titleFontPx, bold: true, anchor: 'end'}, emitText),
        svgTextLines(b.boardInfoLines.map(({text, right, y}) => ({text, x: right, y})), {fontPx: bodyFontPx, anchor: 'end'}, emitText),
        `<rect x="${writeInBox.x + sw / 2}" y="${writeInBox.y + sw / 2}" width="${writeInBox.w - sw}" height="${writeInBox.h - sw}" fill="#fff" stroke="#000" stroke-width="${sw}"/>`,
    ];
    if (art.logoSvgInner) {
        parts.push(
            `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" x="${b.bannerLeft}" y="${b.bannerTitleTop}" width="${b.logoWidthPx}" height="${b.logoHeightPx}" viewBox="0 0 ${SKELLY_LOGO_VIEWBOX_W} ${SKELLY_LOGO_VIEWBOX_H}" preserveAspectRatio="xMidYMin meet" overflow="hidden">${art.logoSvgInner}</svg>`,
        );
    }
    if (b.instLines.length > 0) {
        parts.push(
            svgTextLines([{text: pdfLabels.originInstructionsTitle, x: b.instrLeft, y: b.bannerTextTop}], {fontPx: titleFontPx, bold: true}, emitText),
            svgTextLines(b.instLines.map((text, i) => ({text, x: b.instrLeft, y: b.instBodyY + i * b.bodyLineLead})), {fontPx: bodyFontPx}, emitText),
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
