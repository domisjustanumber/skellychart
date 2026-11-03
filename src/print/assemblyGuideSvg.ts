/**
 * A multi-sheet chart's assembly guide sheet, and the assembled chart with its numbered sheets that the
 * on-screen scale preview shows. Both draw the same numbered, colour-coded sheet blocks.
 */
import {
    charucoBoardPixelLayout,
    charucoCropXRange,
    charucoCropYRange,
    renderCharucoBoardSvgFragment,
} from '../charuco/board.js';
import {ORIGIN_CORNER_MARKER_TOP_ROOM_MM, PIXELS_PER_MM} from './constants.js';
import {sheetColorRgb} from './charucoLayout.js';
import {HELVETICA_BOLD_DIGIT_HEIGHT_EM, helveticaTextWidthPx} from './helveticaMetrics.js';
import {interpolate, pdfLabels} from './labels.js';
import {BANNER_TYPE_PX, wrapHelvetica} from './originBannerLayout.js';
import {originBannerSvg, type OriginBannerInputs} from './originBannerSvg.js';
import {paperById, type PaperId} from './papers.js';
import {sheetSafeMarginsMm, sheetSafeRectPx} from './sheetGeometry.js';
import {capTopToBaseline, FONT, printedBoard, type PrintedBoard, svgCornerMarker} from './svgPrimitives.js';
import type {PrintedChart} from './svgAssemblyTypes.js';
import {escapeXml, svgRootOuterSizeAttrs, svgSheetRoot} from './svgUtils.js';
import {buildPageSpecs, type TilingInfo} from './tiling.js';

/** Largest share of a block's width / height a guide page number may cover, as in the on-screen preview. */
const GUIDE_NUMBER_MAX_BLOCK_FRACTION = 0.5;
/**
 * Blocks at least this share of the largest block's width and height count as full-size; only they set the
 * shared page-number size, so a sliver at the chart's edge doesn't shrink every other number.
 */
const GUIDE_NUMBER_FULL_BLOCK_FRACTION = 0.75;
/** Black outline round the guide's white page numbers (em). */
const GUIDE_NUMBER_STROKE_EM = 0.18;
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
 * A numbered, colour-coded block per chart sheet over a board laid out on a `boardWPx`×`boardHPx` canvas
 * and drawn at (`at.x`, `at.y`), scaled by `at.scale`: outlined in the sheet's colour and, with `at.tint`,
 * washed with it. Every page number gets one size, the largest that fits every full-size block; a smaller
 * block's number shrinks to fit it, so no number is left out. A single-sheet chart has no blocks.
 */
function svgSheetBlocks(
    squaresX: number,
    squaresY: number,
    tiling: TilingInfo,
    boardWPx: number,
    boardHPx: number,
    at: {x: number; y: number; scale: number; strokePx: number; tint: boolean},
): string[] {
    const parts: string[] = [];
    if (tiling.pageCount <= 1) {
        return parts;
    }
    const layout = charucoBoardPixelLayout(boardWPx, boardHPx, squaresX, squaresY);
    const dw = boardWPx * at.scale;
    const dh = boardHPx * at.scale;
    const blocks = buildPageSpecs(squaresX, squaresY, tiling).map((page) => {
        const [l, r] = charucoCropXRange(page.gx0, page.gx1, layout);
        const [t, b] = charucoCropYRange(page.gy0, page.gy1, layout);
        return {
            sheetIndex: page.sheetIndex,
            x: at.x + (l / boardWPx) * dw,
            y: at.y + (t / boardHPx) * dh,
            w: ((r - l) / boardWPx) * dw,
            h: ((b - t) / boardHPx) * dh,
            label: String(page.sheetIndex),
        };
    });
    const sw = at.strokePx;
    for (const b of blocks) {
        const [cr, cg, cb] = sheetColorRgb(b.sheetIndex, tiling.pageCount);
        const fill = at.tint ?`fill="rgb(${cr},${cg},${cb})" fill-opacity="0.3"` : 'fill="none"';
        parts.push(
            `<rect x="${b.x + sw / 2}" y="${b.y + sw / 2}" width="${Math.max(0, b.w - sw)}" height="${Math.max(0, b.h - sw)}" ${fill} stroke="rgb(${cr},${cg},${cb})" stroke-width="${sw}"/>`,
        );
    }

    const fit = (b: (typeof blocks)[number]) => {
        const inkW = helveticaTextWidthPx(b.label, 1, true) + GUIDE_NUMBER_STROKE_EM;
        const inkH = HELVETICA_BOLD_DIGIT_HEIGHT_EM + GUIDE_NUMBER_STROKE_EM;
        return Math.min((b.w * GUIDE_NUMBER_MAX_BLOCK_FRACTION) / inkW, (b.h * GUIDE_NUMBER_MAX_BLOCK_FRACTION) / inkH);
    };
    // Widths follow the column and heights the row, so the block in the widest column and tallest row is
    // always full-size.
    const fullW = GUIDE_NUMBER_FULL_BLOCK_FRACTION * Math.max(...blocks.map((b) => b.w));
    const fullH = GUIDE_NUMBER_FULL_BLOCK_FRACTION * Math.max(...blocks.map((b) => b.h));
    const fs = Math.min(...blocks.filter((b) => b.w >= fullW && b.h >= fullH).map(fit));
    blocks.forEach((b) => {
        const bfs = Math.min(fs, fit(b));
        const cx = Math.round(b.x + b.w / 2);
        const baseline = Math.round(b.y + b.h / 2 + (HELVETICA_BOLD_DIGIT_HEIGHT_EM * bfs) / 2);
        const font = `font-size="${bfs}" font-family="${FONT}" font-weight="bold" text-anchor="middle"`;
        // svg2pdf draws text strokes far too wide, so the outline is a ring of black copies under the
        // white digits.
        const r = (GUIDE_NUMBER_STROKE_EM / 2) * bfs;
        for (let k = 0; k < 16; k++) {
            const a = (k * Math.PI) / 8;
            parts.push(
                `<text x="${(cx + r * Math.cos(a)).toFixed(1)}" y="${(baseline + r * Math.sin(a)).toFixed(1)}" fill="#000" ${font}>${b.label}</text>`,
            );
        }
        parts.push(`<text x="${cx}" y="${baseline}" fill="#fff" ${font}>${b.label}</text>`);
    });
    return parts;
}

/**
 * The assembled multi-sheet chart at full size with the guide's numbered sheet outlines, for the
 * on-screen scale preview. Not printed. The board is left untinted (black on white, as printed) so the
 * preview reads as the real chart.
 */
export function svgAssembledChartWithSheetNumbers(chart: PrintedChart): string {
    const {squaresX, squaresY, tiling} = chart;
    const {geom, wPx: fullWPx, hPx: fullHPx} = printedBoard(squaresX, squaresY, chart.squareMm);
    // Block outlines stay a visible share of a sheet however large the chart is drawn.
    const sw = Math.max(2, Math.round(Math.min(fullWPx / tiling.npx, fullHPx / tiling.npy) * 0.02));
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fullWPx} ${fullHPx}" width="${fullWPx}" height="${fullHPx}">` +
        `<rect width="${fullWPx}" height="${fullHPx}" fill="#fff"/>` +
        renderCharucoBoardSvgFragment(fullWPx, fullHPx, geom) +
        svgSheetBlocks(squaresX, squaresY, tiling, fullWPx, fullHPx, {x: 0, y: 0, scale: 1, strokePx: sw, tint: false}).join('') +
        `</svg>`
    );
}

/**
 * Assembly guide sheet for a multi-sheet chart: the full chart, never rotated against the guide's text (x
 * runs along its lines), with a numbered, colour-coded block per chart sheet as in the on-screen preview,
 * then how to put it together. The origin banner sits above it (so the guide needs no header line). It
 * prints on the chart sheets' own paper, drawn turned on the sheet when that shows the chart larger, so the
 * whole job is one page size.
 */
export function svgAssemblyGuideSheet(o: {
    paperId: PaperId;
    /** Chart sheet size (mm); the guide prints on it, laid out in either orientation. */
    paperWMm: number;
    paperHMm: number;
    board: PrintedBoard;
    tiling: TilingInfo;
    /** What the origin banner above the guide is drawn from; it is laid out for each orientation tried. */
    banner: OriginBannerInputs;
}): string {
    const {paperId, board, tiling} = o;
    const ppm = PIXELS_PER_MM;
    const {bodyFontPx, bodyLineLead} = BANNER_TYPE_PX;
    const {geom, wPx: fullWPx, hPx: fullHPx} = board;
    const {squaresX, squaresY} = geom;
    const gapPx = Math.round(GUIDE_GAP_MM * ppm);
    const markerRoomPx = Math.round(GUIDE_CORNER_MARKER_ROOM_MM * ppm);
    const titleFontPx = Math.round(1.4 * bodyFontPx);
    const body = interpolate(pdfLabels.assemblyGuideBody, {
        pages: tiling.pageCount,
        cols: tiling.npx,
        rows: tiling.npy,
    });

    // A guide drawn turned on the sheet has its top along a portrait sheet's left edge or a landscape
    // sheet's right edge, and keeps the sheet's margins, seen from the guide.
    const sheetPortrait = o.paperWMm < o.paperHMm;
    const m = sheetSafeMarginsMm(o.paperWMm, o.paperHMm);
    const turnedMargins = sheetPortrait
        ? {top: m.left, right: m.top, bottom: m.right, left: m.bottom}
        : {top: m.right, right: m.bottom, bottom: m.left, left: m.top};
    const layoutFor = (turned: boolean) => {
        const [wMm, hMm] = turned ? [o.paperHMm, o.paperWMm] : [o.paperWMm, o.paperHMm];
        const {left, top, right, bottom} = sheetSafeRectPx(wMm, hMm, ppm, turned ? turnedMargins : m);
        const innerW = right - left;
        const text = wrapGuideBody(body, bodyFontPx, bodyLineLead, Math.min(innerW, Math.round(GUIDE_TEXT_MAX_W_MM * ppm)));
        const banner = originBannerSvg(o.banner, wMm, hMm, 'guide', {leftPx: left, rightPx: right, topPx: top});
        const titleTop = banner.bottom;
        const boardTop = titleTop + titleFontPx + gapPx + markerRoomPx;
        const areaW = innerW - markerRoomPx;
        const areaH = bottom - boardTop - gapPx - text.height;
        const fitScale = Math.min(areaW / fullWPx, areaH / fullHPx);
        return {turned, wMm, hMm, left, right, text, banner, titleTop, boardTop, fitScale};
    };
    const candidates = [layoutFor(false)];
    if (Math.abs(o.paperWMm - o.paperHMm) >= 0.01) {
        candidates.push(layoutFor(true));
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
        // Sized explicitly: on a turned guide, % would resolve against the sheet, not the guide.
        `<rect width="${+(g.wMm * ppm).toFixed(3)}" height="${+(g.hMm * ppm).toFixed(3)}" fill="#fff"/>`,
        ...g.banner.parts,
        `<text x="${g.left}" y="${capTopToBaseline(g.titleTop, titleFontPx)}" fill="#000" font-size="${titleFontPx}" font-family="${FONT}" font-weight="bold">${escapeXml(pdfLabels.assemblyGuideTitle)}</text>`,
        `<svg x="${bx}" y="${by}" width="${dw}" height="${dh}" viewBox="0 0 ${fullWPx} ${fullHPx}" overflow="hidden">` +
            `<rect width="${fullWPx}" height="${fullHPx}" fill="#fff"/>` +
            renderCharucoBoardSvgFragment(fullWPx, fullHPx, geom) +
            `</svg>`,
    ];

    parts.push(
        ...svgSheetBlocks(squaresX, squaresY, tiling, fullWPx, fullHPx, {x: bx, y: by, scale, strokePx: Math.max(2, Math.round(0.4 * ppm)), tint: true}),
    );
    parts.push(svgCornerMarker(ppm, bx, by));

    const textTop = Math.round(by + dh + gapPx);
    const tspans = g.text.lines.flatMap((l) => {
        const y = capTopToBaseline(textTop + l.y, bodyFontPx);
        const out: string[] = [];
        if (l.label) {
            out.push(`<tspan x="${g.left}" y="${y}">${escapeXml(l.label)}</tspan>`);
        }
        out.push(`<tspan x="${g.left + l.indent}" y="${y}">${escapeXml(l.text)}</tspan>`);
        return out;
    });
    parts.push(
        `<text fill="#000" font-size="${bodyFontPx}" font-family="${FONT}">${tspans.join('')}</text>`,
    );

    let content = parts.join('');
    if (g.turned) {
        const w = +(o.paperWMm * ppm).toFixed(3);
        const h = +(o.paperHMm * ppm).toFixed(3);
        content = `<g transform="${sheetPortrait ? `translate(0,${h}) rotate(-90)` : `translate(${w},0) rotate(90)`}">${content}</g>`;
    }
    return svgSheetRoot(o.paperWMm, o.paperHMm, svgRootOuterSizeAttrs(o.paperWMm, o.paperHMm, paperById(paperId).units), content);
}
