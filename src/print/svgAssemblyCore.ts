import {
    charucoBoardPixelLayout,
    charucoCropXRange,
    charucoCropYRange,
    renderCharucoBoardSvgFragment,
} from '../charuco/board.js';
import type {CharucoGeometry} from '../charuco/board.js';
import {
    CHARUCO_PRINT_LABEL_SPEC_VERSION,
    JOIN_MEET_DASH_RGB,
    MM_JOIN_STRIP,
    MM_MARGIN_SHEET,
    MM_ORIGIN_BANNER_BELOW_GAP_MM,
    MM_PAGE_NUMBER_CLEARANCE_MM,
    MM_TAPE_LABEL_INSET_FROM_JOIN_MM,
    OPENCV_LABEL_VERSION,
    ORIGIN_BANNER_CONTENT_SIDE_MM,
    ORIGIN_BANNER_CONTENT_TOP_MM,
    ORIGIN_BANNER_TEXT_BASELINE_OFFSET_MM,
    ORIGIN_BANNER_VISUAL_SCALE,
    ORIGIN_CORNER_MARKER_PAD_MM,
    ORIGIN_GAP_BOARD_INFO_TO_INSTRUCTIONS_MM,
    ORIGIN_GAP_QR_TO_BOARD_INFO_MM,
    ORIGIN_GAP_SKELLY_TO_INSTRUCTIONS_MM,
    ORIGIN_MARKER_AXIS_X_RGB,
    ORIGIN_MARKER_AXIS_Y_RGB,
    ORIGIN_PAGE_EXTRA_MM,
    PIXELS_PER_MM,
    QR_SIZE_MM,
} from './constants.js';
import {interpolate, originChartInfoParts, pdfLabels} from './labels.js';
import type {PageSpec, TilingInfo} from './tiling.js';
import type {PrintSvgAssemblyParams, PrintSvgResult} from './svgAssemblyTypes.js';
import {perfDev, perfLog, perfNote, perfSync} from './perfDebug.js';
import {SKELLY_LOGO_VIEWBOX_H, SKELLY_LOGO_VIEWBOX_W} from './originBannerEstimate.js';
import {escapeXml, rgbCss, svgRootOpen, svgRootOuterSizeAttrs, SVG_ROOT_CLOSE} from './svgUtils.js';
import {yieldToMain} from '../ui/yieldToMain.js';

const FONT = 'system-ui, Segoe UI, sans-serif';

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

function wrapText(font: string, text: string, maxW: number): string[] {
    const ctx = measureCtx();
    ctx.font = font;
    const lines: string[] = [];
    for (const para of text.split('\n')) {
        const stripped = para.trim();
        if (!stripped) {
            lines.push('');
            continue;
        }
        const words = stripped.split(/\s+/);
        let lineWords: string[] = [];
        for (const w of words) {
            const trial = [...lineWords, w].join(' ');
            if (ctx.measureText(trial).width <= maxW || lineWords.length === 0) {
                lineWords.push(w);
            } else {
                lines.push(lineWords.join(' '));
                lineWords = [w];
            }
        }
        if (lineWords.length) {
            lines.push(lineWords.join(' '));
        }
    }
    return lines;
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

function svgCornerMarker(ppm: number, cx: number, cy: number): string {
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
    return (
        `<g stroke-linecap="square" stroke-linejoin="miter">` +
        `<line x1="${ix}" y1="${iy}" x2="${ix + hx}" y2="${iy}" stroke="${colX}" stroke-width="${lw}"/>` +
        `<line x1="${ix}" y1="${iy}" x2="${ix}" y2="${iy + hy}" stroke="${colY}" stroke-width="${lw}"/>` +
        `<polygon points="${ix + ax},${iy} ${ix + ax - tri * 2},${iy - tri} ${ix + ax - tri * 2},${iy + tri}" fill="${colX}"/>` +
        `<polygon points="${ix},${iy + ax} ${ix - tri},${iy + ax - tri * 2} ${ix + tri},${iy + ax - tri * 2}" fill="${colY}"/>` +
        `<text x="${ix + ax + 2 * labelGap}" y="${iy}" fill="${colX}" font-size="${fontPx}" font-family="${FONT}" text-anchor="middle" dominant-baseline="middle">x</text>` +
        `<text x="${ix}" y="${iy + ax + 2 * labelGap + labelGap}" fill="${colY}" font-size="${fontPx}" font-family="${FONT}" text-anchor="middle" dominant-baseline="middle">y</text>` +
        `</g>`
    );
}

function aabbOverlap(
    a: [number, number, number, number],
    b: [number, number, number, number],
    gap: number,
): boolean {
    const [ax0, ay0, ax1, ay1] = a;
    const [bx0, by0, bx1, by1] = b;
    return !(ax1 + gap < bx0 || ax0 - gap > bx1 || ay1 + gap < by0 || ay0 - gap > by1);
}

function svgFooterPageNumber(
    text: string,
    pagePxW: number,
    pagePxH: number,
    marginPx: number,
    ppm: number,
    tileBox: [number, number, number, number],
    obstacles: [number, number, number, number][],
    fontPx: number,
): string {
    const ctx = measureCtx();
    ctx.font = `${fontPx}px ${FONT}`;
    const clearancePx = Math.max(1, Math.round(MM_PAGE_NUMBER_CLEARANCE_MM * ppm));
    const innerLeft = marginPx + clearancePx;
    const innerTop = marginPx + clearancePx;
    const innerRight = pagePxW - marginPx - clearancePx;
    const innerBottom = pagePxH - marginPx - clearancePx;
    const pad = Math.max(2, Math.floor(ppm / 6));
    const obs: [number, number, number, number][] = [tileBox, ...obstacles];
    const step = Math.max(4, Math.floor(ppm / 3));

    function bboxOk(bb: [number, number, number, number]): boolean {
        if (bb[0] < innerLeft || bb[1] < innerTop || bb[2] > innerRight || bb[3] > innerBottom) {
            return false;
        }
        for (const o of obs) {
            if (aabbOverlap(bb, o, pad)) {
                return false;
            }
        }
        return true;
    }

    let rx = innerRight;
    let by = innerBottom;
    for (let k = 0; k < 160; k++) {
        const m = ctx.measureText(text);
        const bb: [number, number, number, number] = [rx - m.width, by - 20, rx, by];
        if (bboxOk(bb)) {
            return `<text x="${rx}" y="${by}" fill="#000" font-size="${fontPx}" font-family="${FONT}" text-anchor="end" dominant-baseline="ideographic">${escapeXml(text)}</text>`;
        }
        by -= step;
        if (by < innerTop + 40) {
            by = innerBottom;
            rx -= step;
        }
        if (rx < innerLeft + 40) {
            break;
        }
    }
    return `<text x="${innerLeft}" y="${innerBottom - pad}" fill="#000" font-size="${Math.round(22 * (ppm / 12))}" font-family="${FONT}" dominant-baseline="ideographic">${escapeXml(text)}</text>`;
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

/** One right-aligned `<text>`: bold title line + wrapped body (smaller type), like `originChartInfoParts`. */
function svgCharucoBoardInfoBlock(
    x: number,
    yStart: number,
    titleLine: string,
    titleFontPx: number,
    bodyLines: string[],
    bodyFontPx: number,
    bodyLineLead: number,
    vGapAfterTitle: number,
): string {
    const titleEscaped = escapeXml(titleLine);
    const bodyTspans: string[] = [];
    const titleToBodyDy = titleFontPx + vGapAfterTitle;
    for (let i = 0; i < bodyLines.length; i++) {
        const line = bodyLines[i];
        const inner = line === '' ? '&#xa0;' : escapeXml(line);
        if (i === 0) {
            bodyTspans.push(
                `<tspan x="${x}" dy="${titleToBodyDy}" font-size="${bodyFontPx}" font-weight="normal">${inner}</tspan>`,
            );
        } else {
            bodyTspans.push(`<tspan x="${x}" dy="${bodyLineLead}" font-size="${bodyFontPx}">${inner}</tspan>`);
        }
    }
    return `<text x="${x}" y="${yStart}" fill="#000" font-size="${titleFontPx}" font-family="${FONT}" text-anchor="end" dominant-baseline="hanging"><tspan font-weight="bold">${titleEscaped}</tspan>${bodyTspans.join('')}</text>`;
}

function pageCoordMap(
    spec: PageSpec,
    tiling: TilingInfo,
    pagePxW: number,
    pagePxH: number,
    marginPx: number,
    joinPx: number,
    joinPy: number,
    tileW: number,
    tileH: number,
    paperHMm: number,
    bannerBottomPx: number | null,
    originTopReservePx: number,
    ppm: number,
): [number, number] {
    const ph = paperHMm - 2 * MM_MARGIN_SHEET;
    const phOriginPattern =
        ph - ORIGIN_PAGE_EXTRA_MM - (tiling.npy > 1 ? MM_JOIN_STRIP : 0) - ORIGIN_CORNER_MARKER_PAD_MM;

    const leftX = marginPx + joinPx;
    if (spec.isOriginPage) {
        const g = Math.max(1, Math.round(ORIGIN_CORNER_MARKER_PAD_MM * ppm));
        const tri = Math.max(1, (ppm * 4) / 5);
        const innerLeft = marginPx + joinPx;
        const innerRightExcl = pagePxW - marginPx - joinPx;
        const innerW = innerRightExcl - innerLeft;

        if (bannerBottomPx != null) {
            const slotTop = bannerBottomPx;
            const slotBottom = pagePxH - marginPx - joinPy;
            const availH = slotBottom - slotTop;
            let y0 = tileH >= availH ? slotTop : slotTop + Math.floor((availH - tileH) / 2);
            const minX0 = innerLeft + g + tri;
            const maxX0 = innerRightExcl - tileW;
            let x0: number;
            if (maxX0 >= minX0) {
                const centerX0 = innerLeft + Math.floor((innerW - tileW) / 2);
                x0 = Math.min(Math.max(centerX0, minX0), maxX0);
            } else {
                x0 = leftX + g;
            }
            return [x0, y0];
        }

        const availH = Math.floor(phOriginPattern * ppm);
        const needH = tileH + g;
        const yTop = marginPx + originTopReservePx;
        const y = needH >= availH ? yTop : yTop + Math.floor((availH - needH) / 2);
        return [leftX + g, y + g];
    }

    const innerLeft = marginPx + joinPx;
    const innerRightExcl = pagePxW - marginPx - joinPx;
    const innerW = innerRightExcl - innerLeft;
    let x0: number;
    if (tileW <= innerW) {
        x0 = innerLeft + Math.floor((innerW - tileW) / 2);
    } else {
        x0 = innerLeft;
    }

    const availHMm =
        spec.row === 0 ? ph - (tiling.npy > 1 ? MM_JOIN_STRIP : 0) : ph - (tiling.npy > 1 ? 2 * MM_JOIN_STRIP : 0);
    const availH = Math.floor(availHMm * ppm);
    const yTop = marginPx + (spec.row > 0 ? joinPy : 0);
    if (tileH >= availH) {
        return [x0, yTop];
    }
    return [x0, yTop + Math.floor((availH - tileH) / 2)];
}

function svgVerticalTapeLabel(
    text: string,
    pagePxW: number,
    pagePxH: number,
    marginPx: number,
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
        px = Math.max(marginPx + inset, px);
    } else {
        px = meetX + gapPx;
        px = Math.min(px, pagePxW - marginPx - rw - inset);
    }
    const py = Math.max(0, Math.min(centerY - rh / 2, pagePxH - rh));
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
    marginPx: number,
    pagePxH: number,
    gapPx: number,
    fontPx: number,
    ppm: number,
    joinPy: number,
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
        pyTop = Math.max(marginPx + sheetInset, pyTop);
        const seamBandBottom = meetY - gapPx;
        if (pyTop + rh > seamBandBottom) {
            pyTop = seamBandBottom - rh;
        }
    } else {
        pyTop = meetY + gapPx;
        const innerBottom = pagePxH - marginPx - sheetInset;
        if (pyTop + rh > innerBottom) {
            pyTop = innerBottom - rh;
        }
        if (pyTop < meetY + gapPx) {
            const joinStripTop = pagePxH - marginPx - joinPy;
            pyTop = joinStripTop + Math.max(0, (joinPy - rh) / 2);
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
    const boardInner = perfSync(`renderCharucoBoardSvgFragment (${fullWPx}×${fullHPx}px)`, () =>
        renderCharucoBoardSvgFragment(fullWPx, fullHPx, geom),
    );
    perfNote(
        'Full board embedded per sheet',
        `${(boardInner.length / 1e6).toFixed(2)} MB SVG substring × ${pages.length} pages ≈ ${((boardInner.length * pages.length) / 1e6).toFixed(2)} MB total duplication`,
    );
    abortIfNeeded();
    await yieldStep();

    const boardPxLayout = charucoBoardPixelLayout(fullWPx, fullHPx, squaresX, squaresY);
    const pagePxW = Math.max(1, Math.round(paperWMm * ppm));
    const pagePxH = Math.max(1, Math.round(paperHMm * ppm));
    const [svgWidthAttr, svgHeightAttr] = svgRootOuterSizeAttrs(paperWMm, paperHMm, paperId);
    const marginPx = layoutIntPx(MM_MARGIN_SHEET * ppm);
    const joinPx = tiling.npx > 1 ? Math.round(MM_JOIN_STRIP * ppm) : 0;
    const joinPy = tiling.npy > 1 ? Math.round(MM_JOIN_STRIP * ppm) : 0;
    const totalPages = pages.length;
    const originTopReservePx = layoutIntPx(ORIGIN_PAGE_EXTRA_MM * ppm);
    const bScale = ORIGIN_BANNER_VISUAL_SCALE;
    const bodyFontPx = Math.round(26 * (ppm / 12) * bScale);
    const titleFontPx = Math.round(24 * (ppm / 12) * bScale);
    const bodyLineLead = bodyFontPx + Math.max(4, Math.round(0.52 * ppm * bScale));
    const joinFontPx = bodyFontPx;
    const qrSizePx = Math.max(32, Math.round(QR_SIZE_MM * ppm));

    const skellyW = logoSvgInner ? logoWidthPx : 0;
    const skellyH = logoSvgInner ? logoHeightPx : 0;

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
        let bannerBottomPx: number | null = null;
        const pageObstacles: [number, number, number, number][] = [];

        if (spec.isOriginPage) {
            const sidePad = Math.round(ORIGIN_BANNER_CONTENT_SIDE_MM * ppm);
            const topPad = Math.round(ORIGIN_BANNER_CONTENT_TOP_MM * ppm);
            const bannerLeft = marginPx + sidePad;
            const bannerRightInner = pagePxW - marginPx - sidePad;
            const qrY = marginPx + topPad;
            /** Top edge of every banner column (logo, QR) — flush with inner sheet margin. */
            const bannerTitleTop = qrY;
            const bannerTextTop =
                bannerTitleTop + Math.round(ORIGIN_BANNER_TEXT_BASELINE_OFFSET_MM * ppm);
            const gapBoardQr = Math.round(ORIGIN_GAP_QR_TO_BOARD_INFO_MM * ppm);
            const gapInstBoard = Math.round(ORIGIN_GAP_BOARD_INFO_TO_INSTRUCTIONS_MM * ppm);
            const gapSkellyInst = Math.round(ORIGIN_GAP_SKELLY_TO_INSTRUCTIONS_MM * ppm);

            const qrX = bannerRightInner - qrSizePx;
            const qrStackY = bannerTitleTop;
            const instrLeft = bannerLeft + skellyW + (skellyW > 0 ? gapSkellyInst : 0);
            const boardMetaTitleY = bannerTextTop;
            const minInstColPx = Math.max(1, Math.round(12 * ppm));

            const boardInfoRight = qrX - gapBoardQr;
            const boardColMaxW = Math.max(
                1,
                boardInfoRight - instrLeft - gapInstBoard - minInstColPx,
            );

            const titleFont = `bold ${titleFontPx}px ${FONT}`;
            const bodyFont = `${bodyFontPx}px ${FONT}`;
            const {titleLine: boardTitle, bodyBlock: boardInfoBody} = originChartInfoParts({
                version: CHARUCO_PRINT_LABEL_SPEC_VERSION,
                mm: squareLengthMm,
                squaresX,
                squaresY,
                opencv_version: OPENCV_LABEL_VERSION,
                dictionary_name: 'DICT_4X4_250',
            });
            const boardInfoLines = wrapText(bodyFont, boardInfoBody, boardColMaxW);
            const vGap = Math.max(4, Math.round(ppm * bScale));
            let infoLeft = boardInfoRight;
            const mctx = measureCtx();
            mctx.font = titleFont;
            infoLeft = Math.min(infoLeft, boardInfoRight - mctx.measureText(boardTitle).width);
            mctx.font = bodyFont;
            for (const line of boardInfoLines) {
                const w = mctx.measureText(line).width;
                infoLeft = Math.min(infoLeft, boardInfoRight - w);
            }
            const lineBoardBottom =
                boardMetaTitleY + titleFontPx + vGap + boardInfoLines.length * bodyLineLead;
            parts.push(
                svgCharucoBoardInfoBlock(
                    boardInfoRight,
                    boardMetaTitleY,
                    boardTitle,
                    titleFontPx,
                    boardInfoLines,
                    bodyFontPx,
                    bodyLineLead,
                    vGap,
                ),
            );

            const instructionAllowRight = infoLeft - gapInstBoard;
            if (instructionAllowRight - instrLeft < minInstColPx) {
                throw new Error(
                    'Origin banner layout: insufficient horizontal space for logo, instructions, ChArUco info, and QR on this paper size.',
                );
            }

            if (logoSvgInner && skellyW > 0) {
                parts.push(
                    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" x="${bannerLeft}" y="${bannerTitleTop}" width="${skellyW}" height="${skellyH}" viewBox="0 0 ${SKELLY_LOGO_VIEWBOX_W} ${SKELLY_LOGO_VIEWBOX_H}" preserveAspectRatio="xMidYMin meet" overflow="hidden">${logoSvgInner}</svg>`,
                );
            }

            parts.push(
                svgTextBlock(
                    [pdfLabels.originInstructionsTitle],
                    instrLeft,
                    bannerTextTop,
                    bodyLineLead,
                    'start',
                    titleFont,
                    true,
                ),
            );
            const bodyY = bannerTextTop + titleFontPx + vGap;
            const colW = instructionAllowRight - instrLeft;
            const instLines = wrapText(bodyFont, pdfLabels.originInstructionsBody, colW);
            parts.push(svgTextBlock(instLines, instrLeft, bodyY, bodyLineLead, 'start', bodyFont));
            const instBottom = bodyY + instLines.length * bodyLineLead;

            parts.push(
                `<svg x="${qrX}" y="${qrStackY}" width="${qrSizePx}" height="${qrSizePx}" overflow="hidden">${qrSvgFragment}</svg>`,
            );

            const qrBottom = qrStackY + qrSizePx;
            const skellyBottomExtra = skellyW > 0 ? bannerTitleTop + skellyH : bannerTitleTop;
            const bannerBottom =
                Math.max(lineBoardBottom, instBottom, qrBottom, skellyBottomExtra) +
                Math.round(MM_ORIGIN_BANNER_BELOW_GAP_MM * ppm);
            bannerBottomPx = bannerBottom;
            const bannerMaxPx = marginPx + originTopReservePx + Math.max(2, layoutIntPx(2 * ppm));
            if (bannerBottomPx > bannerMaxPx) {
                throw new Error(
                    'Origin-page top banner taller than reserved strip; increase ORIGIN_PAGE_EXTRA_MM.',
                );
            }
            const padB = Math.max(2, Math.floor(ppm / 4));
            const obstacleRight = qrX + qrSizePx + padB;
            pageObstacles.push([
                bannerLeft - padB,
                bannerTitleTop - padB,
                obstacleRight,
                bannerBottom + padB,
            ]);
        }

        const [x0, y0] = pageCoordMap(
            spec,
            tiling,
            pagePxW,
            pagePxH,
            marginPx,
            joinPx,
            joinPy,
            tw,
            th,
            paperHMm,
            spec.isOriginPage ? bannerBottomPx : null,
            originTopReservePx,
            ppm,
        );

        parts.push(
            `<svg x="${x0}" y="${y0}" width="${tw}" height="${th}" viewBox="${l} ${t} ${tw} ${th}" overflow="hidden">` +
                `<rect x="${l}" y="${t}" width="${tw}" height="${th}" fill="#fff"/>` +
                boardInner +
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
                svgVerticalTapeLabel(msg, pagePxW, pagePxH, marginPx, midPatternY, 'left', x0 - 1, tapeGapPx, ppm, joinFontPx),
            );
        }
        if (spec.col < tiling.npx - 1) {
            const msg = interpolate(pdfLabels.tapeJoinNearPage, {page: spec.sheetIndex + 1});
            parts.push(
                svgVerticalTapeLabel(msg, pagePxW, pagePxH, marginPx, midPatternY, 'right', x0 + tw, tapeGapPx, ppm, joinFontPx),
            );
        }
        if (spec.row > 0) {
            const msg = interpolate(pdfLabels.tapeJoinNearPage, {page: spec.sheetIndex - tiling.npx});
            parts.push(
                svgHorizontalTapeLabel(msg, x0, tw, marginPx, pagePxH, tapeGapPx, joinFontPx, ppm, joinPy, 'above', y0 - 1),
            );
        }
        if (spec.row < tiling.npy - 1) {
            const msg = interpolate(pdfLabels.tapeJoinNearPage, {page: spec.sheetIndex + tiling.npx});
            parts.push(
                svgHorizontalTapeLabel(msg, x0, tw, marginPx, pagePxH, tapeGapPx, joinFontPx, ppm, joinPy, 'below', y0 + th),
            );
        }

        if (spec.isOriginPage) {
            parts.push(svgCornerMarker(ppm, x0, y0));
        }

        if (totalPages > 1) {
            const pn = interpolate(pdfLabels.pageFooter, {current: spec.sheetIndex, total: totalPages});
            const tileBox: [number, number, number, number] = [x0, y0, x0 + tw, y0 + th];
            parts.push(svgFooterPageNumber(pn, pagePxW, pagePxH, marginPx, ppm, tileBox, pageObstacles, bodyFontPx));
        }

        pageSvgs.push(svgRootOpen(pagePxW, pagePxH, svgWidthAttr, svgHeightAttr) + parts.join('') + SVG_ROOT_CLOSE);
        abortIfNeeded();
        await yieldStep();
    }

    if (perfDev()) {
        perfLog('assemble all page SVG strings', performance.now() - pageLoopT0, `${pages.length} pages`);
    }

    return {pages: pageSvgs, totalPages};
}
