import {charucoBoardPixelLayout, charucoCropXRange, charucoCropYRange, renderCharucoBoardSvgFragment} from '../charuco/board.js';
import {
    JOIN_MEET_DASH_RGB,
    MM_HEADER_CONTENT_TOP_MM,
    MM_SHEET_HEADER_BASELINE_MM,
    MM_SHEET_HEADER_GAP_MM,
    MM_TAPE_LABEL_INSET_FROM_JOIN_MM,
    PIXELS_PER_MM,
    SHEET_HEADER_FONT_PX,
} from './constants.js';
import {svgAssemblyGuideSheet} from './assemblyGuideSvg.js';
import {HELVETICA_ASCENT_EM, HELVETICA_DESCENT_EM, helveticaTextWidthPx} from './helveticaMetrics.js';
import {interpolate, pdfLabels} from './labels.js';
import {originBannerSvg, type OriginBannerInputs} from './originBannerSvg.js';
import {paperById} from './papers.js';
import {perfLog, perfNote} from './perfDebug.js';
import {boardRegionMm, originMarkerRoomMm, type SafeRectPx, type SeamSides, seamSides, sheetSafeRectPx} from './sheetGeometry.js';
import type {PrintSvgAssemblyParams, PrintSvgResult} from './svgAssemblyTypes.js';
import {capTopToBaseline, centreToBaseline, FONT, printedBoard, svgCornerMarker} from './svgPrimitives.js';
import {escapeXml, rgbCss, svgRootOuterSizeAttrs, svgSheetRoot} from './svgUtils.js';
import type {PageSpec, TilingInfo} from './tiling.js';
import {IS_DEV} from '../env.js';

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

/** Room (px) kept clear past each end of a side tape label, so it stops short of the sheet's bounds. */
const TAPE_LABEL_END_PAD_PX = 4;

/**
 * Dashed cut line along a seam, as whole-px `<line>` segments: vertical (`v`) at x = `at` from y = `from`
 * to `to` inclusive, or horizontal (`h`) at y = `at` from x = `from` to `to`.
 */
function svgDashedSeam(axis: 'v' | 'h', at: number, from: number, to: number, ppm: number): string {
    if (to < from) {
        return '';
    }
    const [dash, gap] = joinDashGapPpm(ppm);
    const stroke = rgbCss(JOIN_MEET_DASH_RGB);
    const parts: string[] = [];
    let p = from;
    while (p <= to) {
        const end = Math.min(p + dash - 1, to);
        const [x1, y1, x2, y2] = axis === 'v' ? [at, p, at, end] : [p, at, end, at];
        parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="1"/>`);
        p = end + 1 + gap;
    }
    return parts.join('');
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
    safe: SafeRectPx,
    ppm: number,
    fontPx: number,
): string {
    const leftX = safe.left;
    const rightX = safe.right;
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

function svgVerticalTapeLabel(
    text: string,
    bounds: SafeRectPx,
    centerY: number,
    side: 'left' | 'right',
    meetX: number,
    gapPx: number,
    ppm: number,
    fontPx: number,
): string {
    // The label's box: a line high across the seam, its width plus a little padding along it.
    const rw = fontPx * 1.2;
    const rh = helveticaTextWidthPx(text, fontPx) + 2 * TAPE_LABEL_END_PAD_PX;
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
        `<text transform="rotate(${angle} ${cx} ${cy})" x="${cx}" y="${centreToBaseline(cy, fontPx)}" fill="#000" font-size="${fontPx}" font-family="${FONT}" text-anchor="middle">${escapeXml(text)}</text>`
    );
}

/**
 * Tape label `gapPx` above or below the cut line at `meetY`, centred on the tile (or from its left edge
 * when wider). The seam band (`MM_SEAM_LABEL_BAND_MM`) is sized to hold it, so it needs no clamp.
 */
function svgHorizontalTapeLabel(
    text: string,
    tileX0: number,
    tileW: number,
    gapPx: number,
    fontPx: number,
    placement: 'above' | 'below',
    meetY: number,
): string {
    const w = helveticaTextWidthPx(text, fontPx);
    const px = tileX0 + Math.max(0, (tileW - w) / 2);
    if (placement === 'above') {
        const rh = Math.ceil((HELVETICA_ASCENT_EM + HELVETICA_DESCENT_EM) * fontPx);
        const cx = px + w / 2;
        const cy = meetY - gapPx - rh / 2;
        return `<text transform="rotate(180 ${cx} ${cy})" x="${cx}" y="${centreToBaseline(cy, fontPx)}" fill="#000" font-size="${fontPx}" font-family="${FONT}" text-anchor="middle">${escapeXml(text)}</text>`;
    }
    return `<text x="${px}" y="${capTopToBaseline(meetY + gapPx, fontPx)}" fill="#000" font-size="${fontPx}" font-family="${FONT}">${escapeXml(text)}</text>`;
}

export async function renderCharucoPrintSvgCore(params: PrintSvgAssemblyParams): Promise<PrintSvgResult> {
    const ppm = PIXELS_PER_MM;
    const {paperId, squaresX, squaresY, squareLengthMm, markerLengthRatio, tiling, pages, qrSvgFragment, logoSvgInner, chartUrl} =
        params;
    const {paperWMm, paperHMm} = tiling;

    const board = printedBoard(squaresX, squaresY, squareLengthMm, markerLengthRatio);
    const {geom, wPx: fullWPx, hPx: fullHPx} = board;
    perfNote('Board per sheet', `only each sheet's own squares (${fullWPx}×${fullHPx}px board, ${pages.length} sheets)`);

    const boardPxLayout = charucoBoardPixelLayout(fullWPx, fullHPx, squaresX, squaresY);
    const sizeAttrs = svgRootOuterSizeAttrs(paperWMm, paperHMm, paperById(paperId).units);
    const safe = sheetSafeRectPx(paperWMm, paperHMm, ppm);
    // Side tape labels stay inside the safe margins and below the header line.
    const labelBounds: SafeRectPx = {...safe, top: Math.ceil(MM_HEADER_CONTENT_TOP_MM * ppm)};
    const tapeGapPx = tapeLabelInsetFromJoinPx(ppm);
    // Sheets are numbered row by row from 1, so this is how far the sheet across each seam is.
    const neighbourStep: Record<keyof SeamSides, number> = {left: -1, right: 1, top: -tiling.npx, bottom: tiling.npx};
    // Only a single-sheet chart carries the banner on the chart itself; tiling reserved its strip. Its
    // height is whole px at PIXELS_PER_MM; round so float mm never loses a px.
    const bannerOnChart = tiling.pageCount === 1;
    const originTopReservePx = Math.round(tiling.bannerReserveMm * ppm);
    const bannerInputs: OriginBannerInputs = {squaresX, squaresY, squareLengthMm, logoSvgInner, qrSvgFragment};

    const headerLeft = interpolate(pdfLabels.sheetHeaderBrand, {url: chartUrl});
    const headerMiddle = interpolate(pdfLabels.sheetHeaderChart, {
        squaresX,
        squaresY,
        mm: squareLengthMm,
        paper: pdfLabels.sheetHeaderPaper[paperId],
    });

    // Tiling reserved the banner's height (`originBannerReserveMm`, laid out by the same
    // `layoutOriginBanner`), so it fits.
    let originBanner: ReturnType<typeof originBannerSvg> | null = null;
    if (bannerOnChart && pages.some((p) => p.isOriginPage)) {
        originBanner = originBannerSvg(bannerInputs, paperWMm, paperHMm, 'chart');
        const bannerMaxPx = safe.top + originTopReservePx;
        if (originBanner.bottom > bannerMaxPx) {
            throw new Error(`Origin banner is ${originBanner.bottom - bannerMaxPx} px taller than its reserved strip on a ${paperWMm} mm sheet.`);
        }
    }

    const pageSvgs: string[] = [];
    const pageLoopT0 = IS_DEV ? performance.now() : 0;

    for (const spec of pages) {
        await params.betweenSheets?.();

        // The crop ranges already end inside the board.
        const [l, r] = charucoCropXRange(spec.gx0, spec.gx1, boardPxLayout);
        const [t, b] = charucoCropYRange(spec.gy0, spec.gy1, boardPxLayout);
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
                        total: tiling.pageCount,
                        row: spec.row + 1,
                        col: spec.col + 1,
                    }),
                    paperWMm,
                    safe,
                    ppm,
                    SHEET_HEADER_FONT_PX,
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

        // Each seam gets a dashed cut line just outside the tile, then (after all the lines) a tape label
        // naming the sheet across it.
        const seam = seamSides(spec.col, spec.row, tiling);
        if (seam.right) {
            parts.push(svgDashedSeam('v', x0 + tw, y0, y0 + th - 1, ppm));
        }
        if (seam.left) {
            parts.push(svgDashedSeam('v', x0 - 1, y0, y0 + th - 1, ppm));
        }
        if (seam.bottom) {
            parts.push(svgDashedSeam('h', y0 + th, x0, x0 + tw - 1, ppm));
        }
        if (seam.top) {
            parts.push(svgDashedSeam('h', y0 - 1, x0, x0 + tw - 1, ppm));
        }

        const joinsSheet = (side: keyof SeamSides): string =>
            interpolate(pdfLabels.tapeJoinNearPage, {page: spec.sheetIndex + neighbourStep[side]});
        const midPatternY = y0 + th / 2;
        if (seam.left) {
            parts.push(
                svgVerticalTapeLabel(joinsSheet('left'), labelBounds, midPatternY, 'left', x0 - 1, tapeGapPx, ppm, SHEET_HEADER_FONT_PX),
            );
        }
        if (seam.right) {
            parts.push(
                svgVerticalTapeLabel(joinsSheet('right'), labelBounds, midPatternY, 'right', x0 + tw, tapeGapPx, ppm, SHEET_HEADER_FONT_PX),
            );
        }
        if (seam.top) {
            parts.push(
                svgHorizontalTapeLabel(joinsSheet('top'), x0, tw, tapeGapPx, SHEET_HEADER_FONT_PX, 'above', y0 - 1),
            );
        }
        if (seam.bottom) {
            parts.push(
                svgHorizontalTapeLabel(joinsSheet('bottom'), x0, tw, tapeGapPx, SHEET_HEADER_FONT_PX, 'below', y0 + th),
            );
        }

        if (spec.isOriginPage) {
            parts.push(svgCornerMarker(ppm, x0, y0));
        }

        pageSvgs.push(svgSheetRoot(paperWMm, paperHMm, sizeAttrs, parts.join('')));
    }

    if (IS_DEV) {
        perfLog('assemble all page SVG strings', performance.now() - pageLoopT0, `${pages.length} pages`);
    }

    const guide =
        tiling.pageCount > 1
            ? svgAssemblyGuideSheet({paperId, paperWMm, paperHMm, board, tiling, banner: bannerInputs})
            : null;

    return {pages: pageSvgs, guide};
}
