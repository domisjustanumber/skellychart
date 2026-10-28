import {
    charucoBoardPixelLayout,
    charucoCropXRange,
    charucoCropYRange,
    renderCharucoBoardSvgFragment,
} from '../charuco/board.js';
import type {CharucoGeometry} from '../charuco/board.js';
import {APP_VERSION_DISPLAY} from '../appVersion.js';
import {
    JOIN_MEET_DASH_RGB,
    MM_HEADER_CONTENT_TOP_MM,
    MM_SEAM_LABEL_BAND_MM,
    MM_SHEET_HEADER_BASELINE_MM,
    MM_SHEET_HEADER_GAP_MM,
    MM_TAPE_LABEL_INSET_FROM_JOIN_MM,
    ORIGIN_BANNER_VISUAL_SCALE,
    ORIGIN_CORNER_MARKER_PAD_MM,
    ORIGIN_CORNER_MARKER_TOP_ROOM_MM,
    ORIGIN_MARKER_AXIS_X_RGB,
    ORIGIN_MARKER_AXIS_Y_RGB,
    ORIGIN_BANNER_MIN_TYPE_FRACTION,
    PIXELS_PER_MM,
} from './constants.js';
import {charucoPagePrintRgb, computeCharucoPagePreviewRects} from './charucoLayout.js';
import {helveticaTextWidthPx} from './helveticaMetrics.js';
import {interpolate, pdfLabels} from './labels.js';
import {layoutOriginBanner, type OriginBannerLayout, wrapHelvetica} from './originBannerLayout.js';
import type {PageSpec, TilingInfo} from './tiling.js';
import type {PrintSheetSvg, PrintSvgAssemblyParams, PrintSvgResult} from './svgAssemblyTypes.js';
import type {OutlineTextOptions} from './outlineText.js';
import {perfDev, perfLog, perfNote} from './perfDebug.js';
import {boardRegionMm, type EdgesMm, originMarkerRoomMm, sheetSafeMarginsMm} from './sheetGeometry.js';
import {SKELLY_LOGO_VIEWBOX_H, SKELLY_LOGO_VIEWBOX_W} from './skellyLogo.js';
import {escapeXml, rgbCss, svgRootOpen, svgRootOuterSizeAttrs, SVG_ROOT_CLOSE} from './svgUtils.js';
import {yieldToMain} from '../ui/yieldToMain.js';

/**
 * Helvetica is a PDF standard font, so Save as PDF (svg2pdf) draws the face the banner is wrapped with
 * (`helveticaMetrics.ts`). The rest are its metric-compatible stand-ins for Print where Helvetica is not
 * installed (Arial on Windows; Liberation Sans, Arimo or Nimbus Sans on Linux and ChromeOS).
 */
const FONT = "Helvetica, Arial, 'Liberation Sans', Arimo, 'Nimbus Sans', sans-serif";

function layoutIntPx(x: number): number {
    return Math.max(0, Math.floor(x));
}

function joinDashGapPpm(ppm: number): [number, number] {
    const dash = Math.max(4, Math.round(1.0 * ppm));
    const gap = Math.max(2, Math.round(0.45 * ppm));
    return [dash, gap];
}

function tapeLabelInsetFromJoinPx(ppm: number): number {
    return Math.max(1, Math.round(MM_TAPE_LABEL_INSET_FROM_JOIN_MM * ppm));
}

function tapeLabelSheetInsetPx(ppm: number): number {
    return Math.max(1, Math.floor(ppm / 6));
}

let measureCanvas: HTMLCanvasElement | null = null;

function measureCtx(): CanvasRenderingContext2D {
    if (!measureCanvas) {
        measureCanvas = document.createElement('canvas');
    }
    return measureCanvas.getContext('2d')!;
}

function svgDashedVline(x: number, y0: number, y1: number, ppm: number): string {
    if (y1 < y0) {
        return '';
    }
    const [dash, gap] = joinDashGapPpm(ppm);
    const stroke = rgbCss(JOIN_MEET_DASH_RGB);
    const parts: string[] = [];
    let y = y0;
    while (y <= y1) {
        const yEnd = Math.min(y + dash - 1, y1);
        parts.push(
            `<line x1="${x}" y1="${y}" x2="${x}" y2="${yEnd}" stroke="${stroke}" stroke-width="1"/>`,
        );
        y = yEnd + 1 + gap;
    }
    return parts.join('');
}

function svgDashedHline(x0: number, x1: number, y: number, ppm: number): string {
    if (x1 < x0) {
        return '';
    }
    const [dash, gap] = joinDashGapPpm(ppm);
    const stroke = rgbCss(JOIN_MEET_DASH_RGB);
    const parts: string[] = [];
    let x = x0;
    while (x <= x1) {
        const xEnd = Math.min(x + dash - 1, x1);
        parts.push(
            `<line x1="${x}" y1="${y}" x2="${xEnd}" y2="${y}" stroke="${stroke}" stroke-width="1"/>`,
        );
        x = xEnd + 1 + gap;
    }
    return parts.join('');
}

/**
 * Draws one line of text in place of a `<text>` element: print-shop sheets pass `outlineText`, so their
 * text is paths. Home sheets leave it out and keep their `<text>` markup.
 */
export type SvgTextEmitter = (text: string, opts: OutlineTextOptions) => string;

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

/**
 * One header line at the top of the sheet, above everything else on it: `left` from the left safe
 * margin, `middle` centred, `right` ending at the right safe margin. The middle is dropped when the line
 * would not fit, and the type shrinks if even left and right do not.
 */
function svgSheetHeader(
    left: string,
    middle: string,
    right: string,
    paperWMm: number,
    margins: EdgesMm,
    ppm: number,
    fontPx: number,
): string {
    // Rounded inwards from the exact sheet size (Letter and Tabloid are not whole px).
    const leftX = Math.ceil(margins.left * ppm);
    const rightX = Math.floor((paperWMm - margins.right) * ppm);
    const innerW = rightX - leftX;
    const gap = Math.round(MM_SHEET_HEADER_GAP_MM * ppm);
    const width = (t: string, px: number): number => (t ? helveticaTextWidthPx(t, px) : 0);
    const ends = (px: number): number => width(left, px) + width(right, px) + (left && right ? gap : 0);
    const size = ends(fontPx) > innerW ? Math.floor((fontPx * (innerW - gap)) / ends(fontPx)) : fontPx;
    const wL = width(left, size);
    const wM = width(middle, size);
    const wR = width(right, size);
    // Centre the middle on the sheet, or in the space between the ends if that is the only way it fits.
    const freeL = leftX + wL + gap;
    const freeR = rightX - wR - gap;
    let midX: number | null = null;
    if (middle && freeR - freeL >= wM) {
        midX = Math.min(Math.max((paperWMm * ppm) / 2, freeL + wM / 2), freeR - wM / 2);
    }
    const y = Math.round(MM_SHEET_HEADER_BASELINE_MM * ppm);
    const text = (t: string, x: number, anchor: string): string =>
        `<text x="${Math.round(x)}" y="${y}" fill="#000" font-size="${size}" font-family="${FONT}" text-anchor="${anchor}">${escapeXml(t)}</text>`;
    return (
        (left ? text(left, leftX, 'start') : '') +
        (midX !== null ? text(middle, midX, 'middle') : '') +
        (right ? text(right, rightX, 'end') : '')
    );
}

function svgTextBlock(
    lines: string[],
    x: number,
    yStart: number,
    lineLead: number,
    anchor: 'start' | 'end',
    font: string,
    bold = false,
): string {
    const weight = bold ? ' font-weight="bold"' : '';
    const anchorAttr = anchor === 'end' ? ' text-anchor="end"' : '';
    const fontPx = font.match(/\d+/)?.[0] ?? '26';
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
    return `<text x="${x}" y="${yStart}" fill="#000" font-size="${fontPx}" font-family="${FONT}"${anchorAttr}${weight} dominant-baseline="hanging">${tspans.join('')}</text>`;
}

/**
 * One right-aligned `<text>`: bold title line + body pieces placed by `layoutOriginBanner`, then the
 * write-in box for the measured square length. With `emitText`, each line is drawn by it instead.
 */
export function svgCharucoBoardInfoBlock(
    x: number,
    yStart: number,
    titleLine: string,
    titleFontPx: number,
    bodyLines: OriginBannerLayout['boardInfoLines'],
    bodyFontPx: number,
    writeInBox: OriginBannerLayout['writeInBox'],
    ppm: number,
    emitText?: SvgTextEmitter,
): string {
    let box = '';
    if (writeInBox) {
        const sw = Math.max(1, Math.round(0.25 * ppm));
        box = `<rect x="${writeInBox.x + sw / 2}" y="${writeInBox.y + sw / 2}" width="${writeInBox.w - sw}" height="${writeInBox.h - sw}" fill="#fff" stroke="#000" stroke-width="${sw}"/>`;
    }
    if (emitText) {
        const title = emitText(titleLine, {x, y: yStart, fontPx: titleFontPx, bold: true, anchor: 'end', baseline: 'hanging'});
        const body = bodyLines.map(({text, right, y}) =>
            emitText(text, {x: right, y, fontPx: bodyFontPx, anchor: 'end', baseline: 'hanging'}),
        );
        return title + body.join('') + box;
    }
    const titleEscaped = escapeXml(titleLine);
    const bodyTspans = bodyLines.map(({text, right, y}) => {
        const inner = text === '' ? '&#xa0;' : escapeXml(text);
        return `<tspan x="${right}" y="${y}" font-size="${bodyFontPx}" font-weight="normal">${inner}</tspan>`;
    });
    return `<text x="${x}" y="${yStart}" fill="#000" font-size="${titleFontPx}" font-family="${FONT}" text-anchor="end" dominant-baseline="hanging"><tspan font-weight="bold">${titleEscaped}</tspan>${bodyTspans.join('')}</text>${box}`;
}

/** Largest share of a block's width / height a guide page number may cover, as in the on-screen preview. */
const GUIDE_NUMBER_MAX_BLOCK_FRACTION = 0.5;
/** Black outline round the guide's white page numbers (em), as `.sheet-rect-num` on screen. */
const GUIDE_NUMBER_STROKE_EM = 0.18;
/** Helvetica Bold digit height (em). */
const GUIDE_DIGIT_HEIGHT_EM = 0.71;
/**
 * Largest scale the guide draws the board at, so it never prints a full-size (or nearly full-size)
 * copy of the board that could be measured or calibrated from by mistake.
 */
const GUIDE_MAX_BOARD_SCALE = 0.8;
/** Room left of and above the guide's board for the origin corner marker (mm). */
const GUIDE_CORNER_MARKER_ROOM_MM = ORIGIN_CORNER_MARKER_TOP_ROOM_MM;
/** Gap between the guide's title, board and text (mm). */
const GUIDE_GAP_MM = 4;
/** Longest guide text line (mm), so landscape sheets don't run it the full width. */
const GUIDE_TEXT_MAX_W_MM = 190;

interface GuideTextLine {
    /** List number ("1.") drawn at the left edge; the text then starts at `indent`. */
    label: string;
    text: string;
    indent: number;
    y: number;
}

/** Guide body lines from the top (0): numbered items wrap with a hanging indent, after a small gap. */
function wrapGuideBody(body: string, fontPx: number, lineLead: number, maxW: number): {lines: GuideTextLine[]; height: number} {
    const lines: GuideTextLine[] = [];
    let y = 0;
    let listStarted = false;
    for (const para of body.split('\n')) {
        const num = /^(\d+\.)\s+/.exec(para);
        if (!num) {
            for (const text of wrapHelvetica(para, fontPx, false, maxW)) {
                lines.push({label: '', text, indent: 0, y});
                y += lineLead;
            }
            continue;
        }
        if (!listStarted) {
            y += Math.round(lineLead / 2);
            listStarted = true;
        }
        const label = num[1]!;
        const indent = Math.ceil(helveticaTextWidthPx(`${label} `, fontPx));
        wrapHelvetica(para.slice(num[0].length), fontPx, false, maxW - indent).forEach((text, i) => {
            lines.push({label: i === 0 ? label : '', text, indent, y});
            y += lineLead;
        });
    }
    return {lines, height: y};
}

/**
 * Assembly guide sheet for a multi-sheet chart: the full chart, never rotated (x runs across), with a
 * numbered, colour-coded block per chart sheet as in the on-screen preview, then how to put it together.
 * The origin banner sits above it (so the guide needs no header line). The paper is turned whichever way
 * shows the chart largest.
 */
function svgAssemblyGuideSheet(o: {
    paperId: string;
    /** Chart sheet size (mm); the guide uses the same paper in either orientation. */
    paperWMm: number;
    paperHMm: number;
    geom: CharucoGeometry;
    tiling: TilingInfo;
    bodyFontPx: number;
    bodyLineLead: number;
    ppm: number;
    /** Origin banner laid out for a sheet this size; `bottom` includes the gap below it. */
    banner: (sheetWMm: number, sheetHMm: number) => {parts: string[]; bottom: number};
}): PrintSheetSvg {
    const {paperId, geom, tiling, bodyFontPx, bodyLineLead, ppm} = o;
    const {squaresX, squaresY, squareLength} = geom;
    const fullWPx = Math.max(1, layoutIntPx(squaresX * squareLength * ppm));
    const fullHPx = Math.max(1, layoutIntPx(squaresY * squareLength * ppm));
    const gapPx = Math.round(GUIDE_GAP_MM * ppm);
    const markerRoomPx = Math.round(GUIDE_CORNER_MARKER_ROOM_MM * ppm);
    const titleFontPx = Math.round(1.4 * bodyFontPx);
    const body = interpolate(pdfLabels.assemblyGuideBody, {
        sheets: tiling.pageCount,
        cols: tiling.npx,
        rows: tiling.npy,
    });

    const layoutFor = (wMm: number, hMm: number) => {
        const m = sheetSafeMarginsMm(wMm, hMm);
        const left = Math.ceil(m.left * ppm);
        const right = Math.floor((wMm - m.right) * ppm);
        const innerW = right - left;
        const text = wrapGuideBody(body, bodyFontPx, bodyLineLead, Math.min(innerW, Math.round(GUIDE_TEXT_MAX_W_MM * ppm)));
        const banner = o.banner(wMm, hMm);
        const titleTop = banner.bottom;
        const boardTop = titleTop + titleFontPx + gapPx + markerRoomPx;
        const areaW = innerW - markerRoomPx;
        const areaH = Math.floor((hMm - m.bottom) * ppm) - boardTop - gapPx - text.height;
        const fitScale = Math.min(areaW / fullWPx, areaH / fullHPx);
        return {wMm, hMm, left, right, text, banner, titleTop, boardTop, fitScale};
    };
    const candidates = [layoutFor(o.paperWMm, o.paperHMm)];
    if (Math.abs(o.paperWMm - o.paperHMm) >= 0.01) {
        candidates.push(layoutFor(o.paperHMm, o.paperWMm));
    }
    // Pick by the uncapped fit, so a small chart still gets the orientation that matches its shape.
    const g = candidates.reduce((best, c) => (c.fitScale > best.fitScale ? c : best));
    if (!(g.fitScale > 0)) {
        throw new Error('The assembly guide does not fit on this paper size.');
    }
    const scale = Math.min(g.fitScale, GUIDE_MAX_BOARD_SCALE);

    const dw = fullWPx * scale;
    const dh = fullHPx * scale;
    // Centre the board and its corner-marker room together between the safe margins.
    const bx = Math.round(g.left + markerRoomPx + (g.right - g.left - markerRoomPx - dw) / 2);
    const by = g.boardTop;
    const parts: string[] = [
        '<rect width="100%" height="100%" fill="#fff"/>',
        ...g.banner.parts,
        `<text x="${g.left}" y="${g.titleTop}" fill="#000" font-size="${titleFontPx}" font-family="${FONT}" font-weight="bold" dominant-baseline="hanging">${escapeXml(pdfLabels.assemblyGuideTitle)}</text>`,
        `<svg x="${bx}" y="${by}" width="${dw}" height="${dh}" viewBox="0 0 ${fullWPx} ${fullHPx}" overflow="hidden">` +
            `<rect width="${fullWPx}" height="${fullHPx}" fill="#fff"/>` +
            renderCharucoBoardSvgFragment(fullWPx, fullHPx, geom) +
            `</svg>`,
    ];

    const rects = computeCharucoPagePreviewRects(squaresX, squaresY, tiling, fullWPx, fullHPx) ?? [];
    const blocks = rects.map((r) => ({
        r,
        x: bx + r.left * dw,
        y: by + r.top * dh,
        w: r.width * dw,
        h: r.height * dh,
        label: String(r.sheetIndex),
    }));
    const sw = Math.max(2, Math.round(0.4 * ppm));
    for (const b of blocks) {
        const [cr, cg, cb] = charucoPagePrintRgb(b.r.sheetIndex, tiling.pageCount);
        parts.push(
            `<rect x="${b.x + sw / 2}" y="${b.y + sw / 2}" width="${Math.max(0, b.w - sw)}" height="${Math.max(0, b.h - sw)}" fill="rgb(${cr},${cg},${cb})" fill-opacity="0.3" stroke="rgb(${cr},${cg},${cb})" stroke-width="${sw}"/>`,
        );
    }

    // Every page number gets one size, the largest that fits every block, so no number is left out
    // (unlike the on-screen preview, a printed guide has to label every sheet).
    const fs = Math.min(
        ...blocks.map((b) => {
            const inkW = helveticaTextWidthPx(b.label, 1, true) + GUIDE_NUMBER_STROKE_EM;
            const inkH = GUIDE_DIGIT_HEIGHT_EM + GUIDE_NUMBER_STROKE_EM;
            return Math.min((b.w * GUIDE_NUMBER_MAX_BLOCK_FRACTION) / inkW, (b.h * GUIDE_NUMBER_MAX_BLOCK_FRACTION) / inkH);
        }),
    );
    blocks.forEach((b) => {
        const cx = Math.round(b.x + b.w / 2);
        const baseline = Math.round(b.y + b.h / 2 + (GUIDE_DIGIT_HEIGHT_EM * fs) / 2);
        const font = `font-size="${fs}" font-family="${FONT}" font-weight="bold" text-anchor="middle"`;
        // svg2pdf draws text strokes far too wide, so the outline is a ring of black copies under the
        // white digits.
        const r = (GUIDE_NUMBER_STROKE_EM / 2) * fs;
        for (let k = 0; k < 16; k++) {
            const a = (k * Math.PI) / 8;
            parts.push(
                `<text x="${(cx + r * Math.cos(a)).toFixed(1)}" y="${(baseline + r * Math.sin(a)).toFixed(1)}" fill="#000" ${font}>${b.label}</text>`,
            );
        }
        parts.push(`<text x="${cx}" y="${baseline}" fill="#fff" ${font}>${b.label}</text>`);
    });

    parts.push(svgCornerMarker(ppm, bx, by));

    const textTop = Math.round(by + dh + gapPx);
    const tspans = g.text.lines.flatMap((l) => {
        const out: string[] = [];
        if (l.label) {
            out.push(`<tspan x="${g.left}" y="${textTop + l.y}">${escapeXml(l.label)}</tspan>`);
        }
        out.push(`<tspan x="${g.left + l.indent}" y="${textTop + l.y}">${escapeXml(l.text)}</tspan>`);
        return out;
    });
    parts.push(
        `<text fill="#000" font-size="${bodyFontPx}" font-family="${FONT}" dominant-baseline="hanging">${tspans.join('')}</text>`,
    );

    const [wAttr, hAttr] = svgRootOuterSizeAttrs(g.wMm, g.hMm, paperId);
    return {
        svg: svgRootOpen(g.wMm * ppm, g.hMm * ppm, wAttr, hAttr) + parts.join('') + SVG_ROOT_CLOSE,
        paperWMm: g.wMm,
        paperHMm: g.hMm,
    };
}

/**
 * Top-left (px) of a sheet's tile: centred in the sheet's board region (`sheetGeometry.ts`), less the
 * corner marker's room on the first sheet. Tiling sized the tiles to fit these regions.
 */
function pageCoordMap(
    spec: PageSpec,
    tiling: TilingInfo,
    paperWMm: number,
    paperHMm: number,
    tileW: number,
    tileH: number,
    ppm: number,
): [number, number] {
    const r = boardRegionMm(paperWMm, paperHMm, tiling, spec.col, spec.row);
    const marker = spec.isOriginPage ? originMarkerRoomMm(tiling.bannerReserveMm) : {top: 0, left: 0};
    const left = Math.round((r.left + marker.left) * ppm);
    const right = Math.round((paperWMm - r.right) * ppm);
    const top = Math.round((r.top + marker.top) * ppm);
    const bottom = Math.round((paperHMm - r.bottom) * ppm);
    return [left + Math.max(0, Math.floor((right - left - tileW) / 2)), top + Math.max(0, Math.floor((bottom - top - tileH) / 2))];
}

/** Area (px) tape labels must stay inside: the safe margins, and below the header line. */
interface LabelBoundsPx {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

function svgVerticalTapeLabel(
    text: string,
    bounds: LabelBoundsPx,
    centerY: number,
    side: 'left' | 'right',
    meetX: number,
    gapPx: number,
    ppm: number,
    fontPx: number,
): string {
    const ctx = measureCtx();
    ctx.font = `${fontPx}px ${FONT}`;
    const tw = ctx.measureText(text).width;
    const th = fontPx * 1.2;
    const rw = th;
    const rh = tw + 8;
    const inset = tapeLabelSheetInsetPx(ppm);
    let px: number;
    if (side === 'left') {
        px = meetX - gapPx - rw;
        px = Math.max(bounds.left + inset, px);
    } else {
        px = meetX + gapPx;
        px = Math.min(px, bounds.right - rw - inset);
    }
    const py = Math.max(bounds.top, Math.min(centerY - rh / 2, bounds.bottom - rh));
    const cx = px + rw / 2;
    const cy = py + rh / 2;
    const angle = (side === 'left' ? -90 : 90) + 180;
    return (
        `<text transform="rotate(${angle} ${cx} ${cy})" x="${cx}" y="${cy}" fill="#000" font-size="${fontPx}" font-family="${FONT}" text-anchor="middle" dominant-baseline="middle">${escapeXml(text)}</text>`
    );
}

function svgHorizontalTapeLabel(
    text: string,
    tileX0: number,
    tileW: number,
    bounds: LabelBoundsPx,
    gapPx: number,
    fontPx: number,
    ppm: number,
    seamPx: number,
    placement: 'above' | 'below',
    meetY: number,
): string {
    const ctx = measureCtx();
    ctx.font = `${fontPx}px ${FONT}`;
    const m = ctx.measureText(text);
    const ascent = m.actualBoundingBoxAscent ?? fontPx * 0.75;
    const descent = m.actualBoundingBoxDescent ?? fontPx * 0.25;
    const rh = Math.max(1, Math.ceil(ascent + descent));
    const px = tileX0 + Math.max(0, (tileW - m.width) / 2);
    const sheetInset = tapeLabelSheetInsetPx(ppm);
    let pyTop: number;
    if (placement === 'above') {
        pyTop = meetY - gapPx - rh;
        pyTop = Math.max(bounds.top + sheetInset, pyTop);
        const seamBandBottom = meetY - gapPx;
        if (pyTop + rh > seamBandBottom) {
            pyTop = seamBandBottom - rh;
        }
    } else {
        pyTop = meetY + gapPx;
        const innerBottom = bounds.bottom - sheetInset;
        if (pyTop + rh > innerBottom) {
            pyTop = innerBottom - rh;
        }
        if (pyTop < meetY + gapPx) {
            const seamBandTop = bounds.bottom - seamPx;
            pyTop = seamBandTop + Math.max(0, (seamPx - rh) / 2);
        }
    }
    if (placement === 'above') {
        const cx = px + m.width / 2;
        const cy = pyTop + rh / 2;
        return `<text transform="rotate(180 ${cx} ${cy})" x="${cx}" y="${cy}" fill="#000" font-size="${fontPx}" font-family="${FONT}" text-anchor="middle" dominant-baseline="middle">${escapeXml(text)}</text>`;
    }
    return `<text x="${px}" y="${pyTop}" fill="#000" font-size="${fontPx}" font-family="${FONT}" dominant-baseline="hanging">${escapeXml(text)}</text>`;
}

export async function renderCharucoPrintSvgCore(params: PrintSvgAssemblyParams): Promise<PrintSvgResult> {
    const ppm = PIXELS_PER_MM;
    const {
        paperId,
        squaresX,
        squaresY,
        squareLengthMm,
        paperWMm,
        paperHMm,
        markerLengthRatio,
        tiling,
        pages,
        signal,
        qrSvgFragment,
        logoSvgInner,
        logoWidthPx,
        logoHeightPx,
        chartUrl,
        cooperativeYield,
    } = params;

    const yieldStep = (): Promise<void> =>
        cooperativeYield !== false ? yieldToMain() : Promise.resolve();

    const abortIfNeeded = (): void => {
        if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }
    };

    const markerMm = squareLengthMm * markerLengthRatio;
    const geom: CharucoGeometry = {
        squaresX,
        squaresY,
        squareLength: squareLengthMm,
        markerLength: markerMm,
    };

    const fullWPx = Math.max(1, layoutIntPx(squaresX * squareLengthMm * ppm));
    const fullHPx = Math.max(1, layoutIntPx(squaresY * squareLengthMm * ppm));
    perfNote('Board per sheet', `only each sheet's own squares (${fullWPx}×${fullHPx}px board, ${pages.length} sheets)`);
    abortIfNeeded();
    await yieldStep();

    const boardPxLayout = charucoBoardPixelLayout(fullWPx, fullHPx, squaresX, squaresY);
    const pagePxW = Math.max(1, Math.round(paperWMm * ppm));
    const pagePxH = Math.max(1, Math.round(paperHMm * ppm));
    const [svgWidthAttr, svgHeightAttr] = svgRootOuterSizeAttrs(paperWMm, paperHMm, paperId);
    const margins = sheetSafeMarginsMm(paperWMm, paperHMm);
    // Tape labels stay inside the safe margins and below the header line.
    const labelBounds: LabelBoundsPx = {
        left: Math.ceil(margins.left * ppm),
        right: Math.floor((paperWMm - margins.right) * ppm),
        top: Math.ceil(MM_HEADER_CONTENT_TOP_MM * ppm),
        bottom: Math.floor((paperHMm - margins.bottom) * ppm),
    };
    const seamPx = Math.round(MM_SEAM_LABEL_BAND_MM * ppm);
    const totalPages = params.totalPages ?? pages.length;
    // Only a single-sheet chart carries the banner on the chart itself; tiling reserved its strip. Generated
    // heights are whole px at PIXELS_PER_MM; round so float mm never loses a px.
    const bannerOnChart = tiling.pageCount === 1;
    const originTopReservePx = Math.round(tiling.bannerReserveMm * ppm);
    const bScale = ORIGIN_BANNER_VISUAL_SCALE;
    const bodyFontPx = Math.round(26 * (ppm / 12) * bScale);
    const joinFontPx = bodyFontPx;

    const skellyW = logoSvgInner ? logoWidthPx : 0;
    const skellyH = logoSvgInner ? logoHeightPx : 0;

    /**
     * Origin banner (logo, instructions, chart info, QR) at a given type scale on a sheet this size.
     * Returns `null` when the text columns do not fit side by side at that scale.
     */
    const buildOriginBanner = (
        typeScale: number,
        sheetWMm: number,
        sheetHMm: number,
        instructionsBody?: string,
    ): {parts: string[]; bottom: number} | null => {
        const b = layoutOriginBanner({
            paperWMm: sheetWMm,
            paperHMm: sheetHMm,
            typeScale,
            version: APP_VERSION_DISPLAY,
            squareLengthMm,
            squaresX,
            squaresY,
            logoWidthPx: skellyW,
            logoHeightPx: skellyH,
            ppm,
            instructionsBody,
        });
        if (!b) {
            return null;
        }
        const titleFont = `bold ${b.titleFontPx}px ${FONT}`;
        const bodyFont = `${b.bodyFontPx}px ${FONT}`;
        const parts: string[] = [
            svgCharucoBoardInfoBlock(
                b.boardInfoRight,
                b.bannerTextTop,
                b.boardTitle,
                b.titleFontPx,
                b.boardInfoLines,
                b.bodyFontPx,
                b.writeInBox,
                ppm,
            ),
        ];
        if (logoSvgInner && skellyW > 0) {
            parts.push(
                `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" x="${b.bannerLeft}" y="${b.bannerTitleTop}" width="${skellyW}" height="${skellyH}" viewBox="0 0 ${SKELLY_LOGO_VIEWBOX_W} ${SKELLY_LOGO_VIEWBOX_H}" preserveAspectRatio="xMidYMin meet" overflow="hidden">${logoSvgInner}</svg>`,
            );
        }
        parts.push(
            svgTextBlock([pdfLabels.originInstructionsTitle], b.instrLeft, b.bannerTextTop, b.bodyLineLead, 'start', titleFont, true),
            svgTextBlock(b.instLines, b.instrLeft, b.instBodyY, b.bodyLineLead, 'start', bodyFont),
            `<svg x="${b.qrX}" y="${b.bannerTitleTop}" width="${b.qrSizePx}" height="${b.qrSizePx}" overflow="hidden">${qrSvgFragment}</svg>`,
        );
        return {parts, bottom: b.bottom};
    };

    const headerLeft = interpolate(pdfLabels.sheetHeaderBrand, {url: chartUrl});
    const headerMiddle = interpolate(pdfLabels.sheetHeaderChart, {
        squaresX,
        squaresY,
        mm: squareLengthMm,
        paper: pdfLabels.sheetHeaderPaper[paperId] ?? paperId,
    });

    // Tiling reserved exactly the banner's height (`originBannerStrip.generated.ts`, laid out by the same
    // `layoutOriginBanner`), so the full-size banner fits. Stepping the type down only happens if that
    // file is stale; `npm run check:banner` fails the build first.
    let originBanner: ReturnType<typeof buildOriginBanner> = null;
    if (bannerOnChart && pages.some((p) => p.isOriginPage)) {
        const bannerMaxPx = Math.ceil(margins.top * ppm) + originTopReservePx;
        for (let typeScale = bScale; typeScale >= bScale * ORIGIN_BANNER_MIN_TYPE_FRACTION - 1e-9; typeScale -= bScale * 0.05) {
            const candidate = buildOriginBanner(typeScale, paperWMm, paperHMm);
            if (candidate && candidate.bottom <= bannerMaxPx) {
                originBanner = candidate;
                break;
            }
        }
        if (!originBanner) {
            throw new Error('Origin banner does not fit the reserved strip on this paper size.');
        }
        // A stale table shows up as spare space or shrunk type; flag it while editing banner text.
        if (typeof import.meta.env !== 'undefined' && import.meta.env.DEV && originBanner.bottom !== bannerMaxPx) {
            console.warn(
                `Origin banner is ${bannerMaxPx - originBanner.bottom} px off its reserved strip on a ${paperWMm} mm sheet; run \`npm run generate:banner\`.`,
            );
        }
    }

    const pageSvgs: string[] = [];
    const pageLoopT0 = perfDev() ? performance.now() : 0;

    for (const spec of pages) {
        abortIfNeeded();
        await yieldStep();

        let [l, r] = charucoCropXRange(spec.gx0, spec.gx1, boardPxLayout);
        let [t, b] = charucoCropYRange(spec.gy0, spec.gy1, boardPxLayout);
        r = Math.min(r, fullWPx);
        b = Math.min(b, fullHPx);
        const tw = Math.max(1, r - l);
        const th = Math.max(1, b - t);

        const parts: string[] = ['<rect width="100%" height="100%" fill="#fff"/>'];
        // A sheet with the banner already shows the chart's details and link, so it has no header.
        if (spec.isOriginPage && originBanner) {
            parts.push(...originBanner.parts);
        } else {
            parts.push(
                svgSheetHeader(
                    headerLeft,
                    headerMiddle,
                    interpolate(pdfLabels.sheetHeaderPage, {
                        current: spec.sheetIndex,
                        total: totalPages,
                        row: spec.row + 1,
                        col: spec.col + 1,
                    }),
                    paperWMm,
                    margins,
                    ppm,
                    bodyFontPx,
                ),
            );
        }
        const [x0, y0] = pageCoordMap(spec, tiling, paperWMm, paperHMm, tw, th, ppm);

        parts.push(
            `<svg x="${x0}" y="${y0}" width="${tw}" height="${th}" viewBox="${l} ${t} ${tw} ${th}" overflow="hidden">` +
                `<rect x="${l}" y="${t}" width="${tw}" height="${th}" fill="#fff"/>` +
                renderCharucoBoardSvgFragment(fullWPx, fullHPx, geom, spec) +
                `</svg>`,
        );

        if (spec.col < tiling.npx - 1) {
            const xr = x0 + tw;
            if (0 <= xr && xr < pagePxW) {
                parts.push(svgDashedVline(xr, y0, y0 + th - 1, ppm));
            }
        }
        if (spec.col > 0) {
            const xl = x0 - 1;
            if (0 <= xl && xl < pagePxW) {
                parts.push(svgDashedVline(xl, y0, y0 + th - 1, ppm));
            }
        }
        if (spec.row < tiling.npy - 1) {
            const yb = y0 + th;
            if (0 <= yb && yb < pagePxH) {
                parts.push(svgDashedHline(x0, x0 + tw - 1, yb, ppm));
            }
        }
        if (spec.row > 0) {
            const yt = y0 - 1;
            if (0 <= yt && yt < pagePxH) {
                parts.push(svgDashedHline(x0, x0 + tw - 1, yt, ppm));
            }
        }

        const tapeGapPx = tapeLabelInsetFromJoinPx(ppm);
        const midPatternY = y0 + th / 2;
        if (spec.col > 0) {
            const msg = interpolate(pdfLabels.tapeJoinNearPage, {page: spec.sheetIndex - 1});
            parts.push(
                svgVerticalTapeLabel(msg, labelBounds, midPatternY, 'left', x0 - 1, tapeGapPx, ppm, joinFontPx),
            );
        }
        if (spec.col < tiling.npx - 1) {
            const msg = interpolate(pdfLabels.tapeJoinNearPage, {page: spec.sheetIndex + 1});
            parts.push(
                svgVerticalTapeLabel(msg, labelBounds, midPatternY, 'right', x0 + tw, tapeGapPx, ppm, joinFontPx),
            );
        }
        if (spec.row > 0) {
            const msg = interpolate(pdfLabels.tapeJoinNearPage, {page: spec.sheetIndex - tiling.npx});
            parts.push(
                svgHorizontalTapeLabel(msg, x0, tw, labelBounds, tapeGapPx, joinFontPx, ppm, seamPx, 'above', y0 - 1),
            );
        }
        if (spec.row < tiling.npy - 1) {
            const msg = interpolate(pdfLabels.tapeJoinNearPage, {page: spec.sheetIndex + tiling.npx});
            parts.push(
                svgHorizontalTapeLabel(msg, x0, tw, labelBounds, tapeGapPx, joinFontPx, ppm, seamPx, 'below', y0 + th),
            );
        }

        if (spec.isOriginPage) {
            parts.push(svgCornerMarker(ppm, x0, y0));
        }

        pageSvgs.push(svgRootOpen(paperWMm * ppm, paperHMm * ppm, svgWidthAttr, svgHeightAttr) + parts.join('') + SVG_ROOT_CLOSE);
        abortIfNeeded();
        await yieldStep();
    }

    if (perfDev()) {
        perfLog('assemble all page SVG strings', performance.now() - pageLoopT0, `${pages.length} pages`);
    }

    abortIfNeeded();
    const guide =
        tiling.pageCount > 1
            ? svgAssemblyGuideSheet({
                  paperId,
                  paperWMm,
                  paperHMm,
                  geom,
                  tiling,
                  bodyFontPx,
                  bodyLineLead: bodyFontPx + Math.max(4, Math.round(0.52 * ppm * bScale)),
                  ppm,
                  banner: (sheetWMm, sheetHMm) => {
                      // Nothing reserves the guide's banner, so it only steps its type down if the
                      // columns do not fit side by side at full size.
                      for (let ts = bScale; ts >= bScale * ORIGIN_BANNER_MIN_TYPE_FRACTION - 1e-9; ts -= bScale * 0.05) {
                          const b = buildOriginBanner(ts, sheetWMm, sheetHMm, pdfLabels.originInstructionsBodyGuide);
                          if (b) {
                              return b;
                          }
                      }
                      throw new Error('Origin banner does not fit on the assembly guide on this paper size.');
                  },
              })
            : null;

    return {pages: pageSvgs, totalPages, guide};
}
