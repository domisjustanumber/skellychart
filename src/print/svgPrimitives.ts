/**
 * Pieces every printed sheet shares: the font stack, the board at print size and the origin corner
 * marker. A leaf module, so the banner, the assembly guide and the chart sheets can all use it.
 */
import type {CharucoGeometry} from '../charuco/board.js';
import {
    ORIGIN_CORNER_MARKER_PAD_MM,
    ORIGIN_MARKER_AXIS_X_RGB,
    ORIGIN_MARKER_AXIS_Y_RGB,
    PIXELS_PER_MM,
} from './constants.js';
import type {OutlineTextOptions} from './outlineText.js';
import {rgbCss} from './svgUtils.js';

/**
 * Helvetica is a PDF standard font, so Save as PDF (svg2pdf) draws the face the banner is wrapped with
 * (`helveticaMetrics.ts`). The rest are its metric-compatible stand-ins for Print where Helvetica is not
 * installed (Arial on Windows; Liberation Sans, Arimo or Nimbus Sans on Linux and ChromeOS).
 */
export const FONT = "Helvetica, Arial, 'Liberation Sans', Arimo, 'Nimbus Sans', sans-serif";

/**
 * Draws one line of text in place of a `<text>` element: print-shop sheets pass `outlineText`, so their
 * text is paths. Home sheets leave it out and keep their `<text>` markup.
 */
export type SvgTextEmitter = (text: string, opts: OutlineTextOptions) => string;

/** The whole board as printed: its geometry, and its size in whole px at `PIXELS_PER_MM`. */
export interface PrintedBoard {
    geom: CharucoGeometry;
    wPx: number;
    hPx: number;
}

export function printedBoard(
    squaresX: number,
    squaresY: number,
    squareLengthMm: number,
    markerLengthRatio: number,
): PrintedBoard {
    const ppm = PIXELS_PER_MM;
    return {
        geom: {squaresX, squaresY, squareLength: squareLengthMm, markerLength: squareLengthMm * markerLengthRatio},
        wPx: Math.max(1, Math.floor(squaresX * squareLengthMm * ppm)),
        hPx: Math.max(1, Math.floor(squaresY * squareLengthMm * ppm)),
    };
}

/** Origin corner marker: X / Y arrows and their labels at the board's top-left corner (`cx`, `cy`). */
export function svgCornerMarker(ppm: number, cx: number, cy: number, emitText?: SvgTextEmitter): string {
    const g = Math.max(1, Math.round(ORIGIN_CORNER_MARKER_PAD_MM * ppm));
    const ax = 8 * ppm;
    const colX = rgbCss(ORIGIN_MARKER_AXIS_X_RGB);
    const colY = rgbCss(ORIGIN_MARKER_AXIS_Y_RGB);
    const ix = cx - g;
    const iy = cy - g;
    const lw = Math.max(1, Math.floor(ppm / 2));
    const tri = Math.max(1, (ppm * 4) / 5);
    const hx = Math.max(0, ax - 2 * tri);
    const hy = Math.max(0, ax - 2 * tri);
    const fontPx = Math.max(28, Math.round(ax * 0.4));
    const labelGap = Math.max(8, Math.round(0.75 * ppm));
    const xLabel = {x: ix + ax + 2 * labelGap, y: iy};
    const yLabel = {x: ix, y: iy + ax + 2 * labelGap + labelGap};
    const labels = emitText
        ? emitText('x', {...xLabel, fontPx, anchor: 'middle', baseline: 'middle', fill: colX}) +
          emitText('y', {...yLabel, fontPx, anchor: 'middle', baseline: 'middle', fill: colY})
        : `<text x="${xLabel.x}" y="${xLabel.y}" fill="${colX}" font-size="${fontPx}" font-family="${FONT}" text-anchor="middle" dominant-baseline="middle">x</text>` +
          `<text x="${yLabel.x}" y="${yLabel.y}" fill="${colY}" font-size="${fontPx}" font-family="${FONT}" text-anchor="middle" dominant-baseline="middle">y</text>`;
    return (
        `<g stroke-linecap="square" stroke-linejoin="miter">` +
        `<line x1="${ix}" y1="${iy}" x2="${ix + hx}" y2="${iy}" stroke="${colX}" stroke-width="${lw}"/>` +
        `<line x1="${ix}" y1="${iy}" x2="${ix}" y2="${iy + hy}" stroke="${colY}" stroke-width="${lw}"/>` +
        `<polygon points="${ix + ax},${iy} ${ix + ax - tri * 2},${iy - tri} ${ix + ax - tri * 2},${iy + tri}" fill="${colX}"/>` +
        `<polygon points="${ix},${iy + ax} ${ix - tri},${iy + ax - tri * 2} ${ix + tri},${iy + ax - tri * 2}" fill="${colY}"/>` +
        labels +
        `</g>`
    );
}
