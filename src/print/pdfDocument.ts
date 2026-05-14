import {jsPDF} from 'jspdf';
import QRCode from 'qrcode';
import {
    charucoBoardPixelLayout,
    charucoCropXRange,
    charucoCropYRange,
    grayToRgba,
    renderCharucoBoardGray,
} from '../charuco/board.js';
import type {CharucoGeometry} from '../charuco/board.js';
import {
    CHARUCO_PRINT_LABEL_SPEC_VERSION,
    CHARUCO_PRINT_SOURCE_URL,
    JOIN_MEET_DASH_RGB,
    MM_JOIN_STRIP,
    MM_MARGIN_SHEET,
    MM_ORIGIN_BANNER_BELOW_GAP_MM,
    MM_PAGE_NUMBER_CLEARANCE_MM,
    MM_TAPE_LABEL_INSET_FROM_JOIN_MM,
    OPENCV_LABEL_VERSION,
    SKELLY_TOP_HEIGHT_MM,
    ORIGIN_BANNER_CONTENT_SIDE_MM,
    ORIGIN_BANNER_CONTENT_TOP_MM,
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
import {interpolate, pdfLabels} from './labels.js';
import type {PageSpec, TilingInfo} from './tiling.js';
import {yieldToMain} from '../ui/yieldToMain.js';

/** Match Python `int(x)` for nonnegative layout pixels (`charuco_board_print.py`). */
function layoutIntPx(x: number): number {
    return Math.max(0, Math.floor(x));
}

function charucoCv2QueryValue(markerLengthRatio: number): string {
    return `${OPENCV_LABEL_VERSION}+DICT_4X4_250+ratio=${markerLengthRatio}`;
}

export function buildCharucoDocumentationUrl(
    sourceUrl: string,
    squaresX: number,
    squaresY: number,
    squareLengthMm: number,
    markerLengthRatio: number,
): string {
    const u = new URL(sourceUrl);
    u.searchParams.set('v', String(CHARUCO_PRINT_LABEL_SPEC_VERSION));
    u.searchParams.set('w', String(squaresX));
    u.searchParams.set('h', String(squaresY));
    u.searchParams.set('s', String(squareLengthMm));
    u.searchParams.set('cv2', charucoCv2QueryValue(markerLengthRatio));
    return u.toString();
}

function joinDashGapPpm(ppm: number): [number, number] {
    const dash = Math.max(4, Math.round(1.0 * ppm));
    const gap = Math.max(2, Math.round(0.45 * ppm));
    return [dash, gap];
}

/** Pixel gap from dashed seam to tape-instruction label (see `MM_TAPE_LABEL_INSET_FROM_JOIN_MM`). */
function tapeLabelInsetFromJoinPx(ppm: number): number {
    return Math.max(1, Math.round(MM_TAPE_LABEL_INSET_FROM_JOIN_MM * ppm));
}

/** Minimum inset from printable sheet edge when placing tape labels (matches vertical-label clamp). */
function tapeLabelSheetInsetPx(ppm: number): number {
    return Math.max(1, Math.floor(ppm / 6));
}

function drawDashedVline(
    ctx: CanvasRenderingContext2D,
    x: number,
    y0: number,
    y1: number,
    ppm: number,
): void {
    if (y1 < y0) {
        return;
    }
    const [dash, gap] = joinDashGapPpm(ppm);
    ctx.strokeStyle = `rgb(${JOIN_MEET_DASH_RGB.join(',')})`;
    ctx.lineWidth = 1;
    let y = y0;
    while (y <= y1) {
        const yEnd = Math.min(y + dash - 1, y1);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, yEnd);
        ctx.stroke();
        y = yEnd + 1 + gap;
    }
}

function drawDashedHline(
    ctx: CanvasRenderingContext2D,
    x0: number,
    x1: number,
    y: number,
    ppm: number,
): void {
    if (x1 < x0) {
        return;
    }
    const [dash, gap] = joinDashGapPpm(ppm);
    ctx.strokeStyle = `rgb(${JOIN_MEET_DASH_RGB.join(',')})`;
    ctx.lineWidth = 1;
    let x = x0;
    while (x <= x1) {
        const xEnd = Math.min(x + dash - 1, x1);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(xEnd, y);
        ctx.stroke();
        x = xEnd + 1 + gap;
    }
}

function drawCornerMarker(ctx: CanvasRenderingContext2D, ppm: number, cx: number, cy: number): void {
    const g = Math.max(1, Math.round(ORIGIN_CORNER_MARKER_PAD_MM * ppm));
    const ax = 8 * ppm;
    const colX = ORIGIN_MARKER_AXIS_X_RGB;
    const colY = ORIGIN_MARKER_AXIS_Y_RGB;
    const ix = cx - g;
    const iy = cy - g;
    const lw = Math.max(1, Math.floor(ppm / 2));
    const tri = Math.max(1, (ppm * 4) / 5);
    const hx = Math.max(0, ax - 2 * tri);
    const hy = Math.max(0, ax - 2 * tri);
    ctx.strokeStyle = `rgb(${colX.join(',')})`;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(ix, iy);
    ctx.lineTo(ix + hx, iy);
    ctx.stroke();
    ctx.strokeStyle = `rgb(${colY.join(',')})`;
    ctx.beginPath();
    ctx.moveTo(ix, iy);
    ctx.lineTo(ix, iy + hy);
    ctx.stroke();
    ctx.fillStyle = `rgb(${colX.join(',')})`;
    ctx.beginPath();
    ctx.moveTo(ix + ax, iy);
    ctx.lineTo(ix + ax - tri * 2, iy - tri);
    ctx.lineTo(ix + ax - tri * 2, iy + tri);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgb(${colY.join(',')})`;
    ctx.beginPath();
    ctx.moveTo(ix, iy + ax);
    ctx.lineTo(ix - tri, iy + ax - tri * 2);
    ctx.lineTo(ix + tri, iy + ax - tri * 2);
    ctx.closePath();
    ctx.fill();

    const fontPx = Math.max(28, Math.round(ax * 0.4));
    ctx.font = `${fontPx}px system-ui, Segoe UI, sans-serif`;
    ctx.fillStyle = `rgb(${colX.join(',')})`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelGap = Math.max(8, Math.round(0.75 * ppm));
    ctx.fillText('x', ix + ax + 2 * labelGap, iy);
    ctx.fillStyle = `rgb(${colY.join(',')})`;
    ctx.fillText('y', ix, iy + ax + 2 * labelGap + labelGap);
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

function drawFooterPageNumber(
    ctx: CanvasRenderingContext2D,
    text: string,
    pagePxW: number,
    pagePxH: number,
    marginPx: number,
    ppm: number,
    tileBox: [number, number, number, number],
    obstacles: [number, number, number, number][],
): void {
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
            ctx.fillStyle = '#000';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'bottom';
            ctx.font = `${Math.round(26 * (ppm / 12))}px system-ui, Segoe UI, sans-serif`;
            ctx.fillText(text, rx, by);
            return;
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
    ctx.fillStyle = '#000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.font = `${Math.round(22 * (ppm / 12))}px system-ui, Segoe UI, sans-serif`;
    ctx.fillText(text, innerLeft, innerBottom - pad);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
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

export interface PrintPdfParams {
    squaresX: number;
    squaresY: number;
    squareLengthMm: number;
    paperWMm: number;
    paperHMm: number;
    markerLengthRatio: number;
    tiling: TilingInfo;
    pages: PageSpec[];
    documentationSourceUrl?: string;
    /** When aborted (e.g. preview superseded), rendering stops cooperatively between pages. */
    signal?: AbortSignal;
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

export async function renderCharucoPrintPdf(params: PrintPdfParams): Promise<Blob> {
    const ppm = PIXELS_PER_MM;
    const {
        squaresX,
        squaresY,
        squareLengthMm,
        paperWMm,
        paperHMm,
        markerLengthRatio,
        tiling,
        pages,
        signal,
    } = params;

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
    const fullGray = renderCharucoBoardGray(fullWPx, fullHPx, geom);
    abortIfNeeded();
    await yieldToMain();
    const fullRgba = grayToRgba(fullGray, fullWPx, fullHPx);
    abortIfNeeded();
    await yieldToMain();
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = fullWPx;
    fullCanvas.height = fullHPx;
    fullCanvas.getContext('2d')!.putImageData(
        new ImageData(fullRgba as Uint8ClampedArray<ArrayBuffer>, fullWPx, fullHPx),
        0,
        0,
    );

    const boardPxLayout = charucoBoardPixelLayout(fullWPx, fullHPx, squaresX, squaresY);
    abortIfNeeded();
    await yieldToMain();

    const docUrl = buildCharucoDocumentationUrl(
        params.documentationSourceUrl ?? CHARUCO_PRINT_SOURCE_URL,
        squaresX,
        squaresY,
        squareLengthMm,
        markerLengthRatio,
    );
    const qrDataUrl = await QRCode.toDataURL(docUrl, {margin: 0, width: Math.max(32, Math.round(QR_SIZE_MM * ppm))});

    const pagePxW = Math.max(1, Math.round(paperWMm * ppm));
    const pagePxH = Math.max(1, Math.round(paperHMm * ppm));
    const marginPx = layoutIntPx(MM_MARGIN_SHEET * ppm);
    const joinPx = tiling.npx > 1 ? Math.round(MM_JOIN_STRIP * ppm) : 0;
    const joinPy = tiling.npy > 1 ? Math.round(MM_JOIN_STRIP * ppm) : 0;
    const totalPdfPages = pages.length;
    const originTopReservePx = layoutIntPx(ORIGIN_PAGE_EXTRA_MM * ppm);
    const bodyFontPx = Math.round(26 * (ppm / 12));
    const titleFontPx = Math.round(24 * (ppm / 12));
    const bodyLineLead = bodyFontPx + Math.max(4, Math.round(0.52 * ppm));
    const joinFontPx = bodyFontPx;

    const pdf = new jsPDF({
        orientation: paperWMm > paperHMm ? 'landscape' : 'portrait',
        unit: 'mm',
        format: [paperWMm, paperHMm],
    });

    const qrImg = await loadImage(qrDataUrl);
    abortIfNeeded();
    await yieldToMain();
    const skellyBanner = await loadSkellyBannerRaster(ppm);
    abortIfNeeded();
    await yieldToMain();

    for (const spec of pages) {
        abortIfNeeded();
        await yieldToMain();
        if (spec.sheetIndex > 1) {
            pdf.addPage([paperWMm, paperHMm], paperWMm > paperHMm ? 'landscape' : 'portrait');
        }

        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = pagePxW;
        pageCanvas.height = pagePxH;
        const ctx = pageCanvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, pagePxW, pagePxH);

        let [l, r] = charucoCropXRange(spec.gx0, spec.gx1, boardPxLayout);
        let [t, b] = charucoCropYRange(spec.gy0, spec.gy1, boardPxLayout);
        r = Math.min(r, fullWPx);
        b = Math.min(b, fullHPx);
        const tw = Math.max(1, r - l);
        const th = Math.max(1, b - t);

        let bannerBottomPx: number | null = null;
        let originBannerBox: [number, number, number, number] | null = null;
        const pageObstacles: [number, number, number, number][] = [];

        if (spec.isOriginPage) {
            const sidePad = Math.round(ORIGIN_BANNER_CONTENT_SIDE_MM * ppm);
            const topPad = Math.round(ORIGIN_BANNER_CONTENT_TOP_MM * ppm);
            const bannerLeft = marginPx + sidePad;
            const bannerRightInner = pagePxW - marginPx - sidePad;
            const qrY = marginPx + topPad;
            const qrX = bannerRightInner - qrImg.width;
            const bannerTitleTop = qrY;
            const gapBoardQr = Math.round(ORIGIN_GAP_QR_TO_BOARD_INFO_MM * ppm);
            const gapInstBoard = Math.round(ORIGIN_GAP_BOARD_INFO_TO_INSTRUCTIONS_MM * ppm);
            const gapSkellyInst = Math.round(ORIGIN_GAP_SKELLY_TO_INSTRUCTIONS_MM * ppm);
            const boardInfoRight = qrX - gapBoardQr;
            let skellyW = 0;
            let skellyH = 0;
            if (skellyBanner) {
                skellyW = skellyBanner.w;
                skellyH = skellyBanner.h;
            }
            let instrLeft = bannerLeft + skellyW + (skellyW > 0 ? gapSkellyInst : 0);
            const minInstColPx = Math.max(1, Math.round(12 * ppm));

            ctx.font = `bold ${titleFontPx}px system-ui, Segoe UI, sans-serif`;
            ctx.fillStyle = '#000';
            const boardTitle = interpolate(pdfLabels.originTitleLine, {
                version: CHARUCO_PRINT_LABEL_SPEC_VERSION,
            });

            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            ctx.fillText(boardTitle, boardInfoRight, bannerTitleTop);

            const boardColMaxW = Math.max(
                1,
                boardInfoRight - instrLeft - gapInstBoard - minInstColPx,
            );
            const boardInfoBlock = [
                interpolate(pdfLabels.originSquareSizeLine, {mm: squareLengthMm}),
                interpolate(pdfLabels.originWidthLine, {n: squaresX}),
                interpolate(pdfLabels.originHeightLine, {n: squaresY}),
                interpolate(pdfLabels.originOpenCvLine, {
                    opencv_version: OPENCV_LABEL_VERSION,
                    dictionary_name: 'DICT_4X4_250',
                }),
            ].join('\n');

            ctx.font = `${bodyFontPx}px system-ui, Segoe UI, sans-serif`;
            const boardInfoLines = wrapText(ctx, boardInfoBlock, boardColMaxW);
            let by = bannerTitleTop + titleFontPx + Math.max(4, ppm);
            let infoLeft = boardInfoRight;
            for (const line of boardInfoLines) {
                const w = ctx.measureText(line).width;
                infoLeft = Math.min(infoLeft, boardInfoRight - w);
                ctx.fillText(line, boardInfoRight, by);
                by += bodyLineLead;
            }
            const lineBoardBottom = by;
            ctx.textAlign = 'left';

            const instructionAllowRight = infoLeft - gapInstBoard;
            if (instructionAllowRight - instrLeft < minInstColPx) {
                throw new Error(
                    'Origin banner layout: insufficient horizontal space for logo, instructions, ChaRuCo info, and QR on this paper size.',
                );
            }

            if (skellyBanner && skellyW > 0) {
                ctx.drawImage(skellyBanner.img, bannerLeft, qrY, skellyW, skellyH);
            }

            const instTitle = pdfLabels.originInstructionsTitle;
            ctx.font = `bold ${titleFontPx}px system-ui, Segoe UI, sans-serif`;
            ctx.fillText(instTitle, instrLeft, bannerTitleTop);
            const titleBB = titleFontPx;
            const bodyY = bannerTitleTop + titleBB + Math.max(4, ppm);
            ctx.font = `${bodyFontPx}px system-ui, Segoe UI, sans-serif`;
            const colW = instructionAllowRight - instrLeft;
            const instLines = wrapText(ctx, pdfLabels.originInstructions + '\n' + pdfLabels.originInstructionsDocumentationFooter, colW);
            let iy = bodyY;
            for (const line of instLines) {
                ctx.fillText(line, instrLeft, iy);
                iy += bodyLineLead;
            }
            const instBottom = iy;

            ctx.drawImage(qrImg, qrX, bannerTitleTop);
            const skellyBottomExtra = skellyW > 0 ? qrY + skellyH : qrY;
            const bannerBottom =
                Math.max(lineBoardBottom, instBottom, qrY + qrImg.height, skellyBottomExtra) +
                Math.round(MM_ORIGIN_BANNER_BELOW_GAP_MM * ppm);
            bannerBottomPx = bannerBottom;
            const bannerMaxPx = marginPx + originTopReservePx + Math.max(2, layoutIntPx(2 * ppm));
            if (bannerBottomPx > bannerMaxPx) {
                throw new Error(
                    'Origin-page top banner taller than reserved strip; increase ORIGIN_PAGE_EXTRA_MM.',
                );
            }
            const padB = Math.max(2, Math.floor(ppm / 4));
            originBannerBox = [
                bannerLeft - padB,
                bannerTitleTop - padB,
                qrX + qrImg.width + padB,
                bannerBottom + padB,
            ];
            pageObstacles.push(originBannerBox);
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

        ctx.drawImage(fullCanvas, l, t, tw, th, x0, y0, tw, th);

        const drawJoin = (): void => {
            if (spec.col < tiling.npx - 1) {
                const xr = x0 + tw;
                if (0 <= xr && xr < pagePxW) {
                    drawDashedVline(ctx, xr, y0, y0 + th - 1, ppm);
                }
            }
            if (spec.col > 0) {
                const xl = x0 - 1;
                if (0 <= xl && xl < pagePxW) {
                    drawDashedVline(ctx, xl, y0, y0 + th - 1, ppm);
                }
            }
            if (spec.row < tiling.npy - 1) {
                const yb = y0 + th;
                if (0 <= yb && yb < pagePxH) {
                    drawDashedHline(ctx, x0, x0 + tw - 1, yb, ppm);
                }
            }
            if (spec.row > 0) {
                const yt = y0 - 1;
                if (0 <= yt && yt < pagePxH) {
                    drawDashedHline(ctx, x0, x0 + tw - 1, yt, ppm);
                }
            }
        };
        drawJoin();

        const tapeGapPx = tapeLabelInsetFromJoinPx(ppm);
        ctx.save();
        ctx.font = `${joinFontPx}px system-ui, Segoe UI, sans-serif`;
        ctx.fillStyle = '#000';
        const midPatternY = y0 + th / 2;

        if (spec.col > 0) {
            const msg = interpolate(pdfLabels.tapeJoinNearPage, {page: spec.sheetIndex - 1});
            drawVerticalTapeLabel(ctx, msg, pagePxW, pagePxH, marginPx, joinPx, midPatternY, 'left', x0 - 1, tapeGapPx, ppm);
        }
        if (spec.col < tiling.npx - 1) {
            const msg = interpolate(pdfLabels.tapeJoinNearPage, {page: spec.sheetIndex + 1});
            drawVerticalTapeLabel(ctx, msg, pagePxW, pagePxH, marginPx, joinPx, midPatternY, 'right', x0 + tw, tapeGapPx, ppm);
        }
        if (spec.row > 0) {
            const msg = interpolate(pdfLabels.tapeJoinNearPage, {page: spec.sheetIndex - tiling.npx});
            drawHorizontalTapeLabel(ctx, msg, x0, tw, marginPx, pagePxH, tapeGapPx, joinFontPx, ppm, joinPy, 'above', y0 - 1);
        }
        if (spec.row < tiling.npy - 1) {
            const msg = interpolate(pdfLabels.tapeJoinNearPage, {page: spec.sheetIndex + tiling.npx});
            drawHorizontalTapeLabel(ctx, msg, x0, tw, marginPx, pagePxH, tapeGapPx, joinFontPx, ppm, joinPy, 'below', y0 + th);
        }
        ctx.restore();

        if (spec.isOriginPage) {
            drawCornerMarker(ctx, ppm, x0, y0);
        }

        if (totalPdfPages > 1) {
            const pn = interpolate(pdfLabels.pageFooter, {current: spec.sheetIndex, total: totalPdfPages});
            const tileBox: [number, number, number, number] = [x0, y0, x0 + tw, y0 + th];
            drawFooterPageNumber(ctx, pn, pagePxW, pagePxH, marginPx, ppm, tileBox, pageObstacles);
        }

        const dataUrl = pageCanvas.toDataURL('image/png');
        pdf.addImage(dataUrl, 'PNG', 0, 0, paperWMm, paperHMm, undefined, 'SLOW');
        abortIfNeeded();
        await yieldToMain();
    }

    abortIfNeeded();
    await yieldToMain();
    return pdf.output('blob');
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = src;
    });
}

async function loadSkellyBannerRaster(ppm: number): Promise<{img: HTMLImageElement; w: number; h: number} | null> {
    const tryFromHref = async (href: string) => {
        const img = await loadImage(href);
        const nh = Math.max(1, Math.round(SKELLY_TOP_HEIGHT_MM * ppm));
        const nw = Math.max(1, Math.round((img.naturalWidth * nh) / img.naturalHeight));
        return {img, w: nw, h: nh};
    };

    if (typeof window !== 'undefined') {
        try {
            const href = new URL('/freemocap-logo.svg', window.location.origin).href;
            return await tryFromHref(href);
        } catch {
            /* try fallbacks */
        }
    }

    const logoFile = typeof process !== 'undefined' ? process.env.CHARUCO_LOGO_FILE?.trim() : '';
    if (logoFile) {
        try {
            const {pathToFileURL} = await import(/* @vite-ignore */ 'node:url');
            return await tryFromHref(pathToFileURL(logoFile).href);
        } catch {
            return null;
        }
    }

    return null;
}

function drawVerticalTapeLabel(
    ctx: CanvasRenderingContext2D,
    text: string,
    pagePxW: number,
    pagePxH: number,
    marginPx: number,
    _joinStripPx: number,
    centerY: number,
    side: 'left' | 'right',
    meetX: number,
    gapPx: number,
    ppm: number,
): void {
    const c = document.createElement('canvas');
    const pad = Math.max(2, Math.floor(ppm / 4));
    c.width = 400;
    c.height = 80;
    const sctx = c.getContext('2d')!;
    sctx.font = ctx.font;
    sctx.fillStyle = '#000';
    sctx.fillText(text, pad, 40);
    const off = document.createElement('canvas');
    const w = 80;
    const h = 400;
    off.width = w;
    off.height = h;
    const o = off.getContext('2d')!;
    o.translate(w / 2, h / 2);
    // +90° left / −90° right keeps copy upright when printed; the previous pair read upside‑down.
    o.rotate(side === 'left' ? Math.PI / 2 : -Math.PI / 2);
    o.drawImage(c, -200, -40);
    const rw = off.width;
    const rh = off.height;
    let px: number;
    const inset = tapeLabelSheetInsetPx(ppm);
    if (side === 'left') {
        px = meetX - gapPx - rw;
        px = Math.max(marginPx + inset, px);
    } else {
        px = meetX + gapPx;
        px = Math.min(px, pagePxW - marginPx - rw - inset);
    }
    const py = Math.max(0, Math.min(centerY - rh / 2, pagePxH - rh));
    ctx.drawImage(off, px, py);
}

/** Horizontal tape instruction above (`meetY` = dashed line) or below it. Uses direct `fillText` on the page canvas so orientation matches other printed copy (avoids rare flipped bitmap compositing from small scratch canvases). */
function drawHorizontalTapeLabel(
    ctx: CanvasRenderingContext2D,
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
): void {
    const sheetInset = tapeLabelSheetInsetPx(ppm);

    ctx.save();
    ctx.resetTransform();
    ctx.font = `${fontPx}px system-ui, Segoe UI, sans-serif`;
    ctx.fillStyle = '#000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.direction = 'ltr';

    const m = ctx.measureText(text);
    const ascent = m.actualBoundingBoxAscent ?? fontPx * 0.75;
    const descent = m.actualBoundingBoxDescent ?? fontPx * 0.25;
    const rh = Math.max(1, Math.ceil(ascent + descent));
    const px = tileX0 + Math.max(0, (tileW - m.width) / 2);

    if (placement === 'above') {
        let pyTop = meetY - gapPx - rh;
        pyTop = Math.max(marginPx + sheetInset, pyTop);
        const seamBandBottom = meetY - gapPx;
        if (pyTop + rh > seamBandBottom) {
            pyTop = seamBandBottom - rh;
        }
        ctx.fillText(text, px, pyTop);
    } else {
        let pyTop = meetY + gapPx;
        const innerBottom = pagePxH - marginPx - sheetInset;
        if (pyTop + rh > innerBottom) {
            pyTop = innerBottom - rh;
        }
        if (pyTop < meetY + gapPx) {
            const joinStripTop = pagePxH - marginPx - joinPy;
            pyTop = joinStripTop + Math.max(0, (joinPy - rh) / 2);
        }
        ctx.fillText(text, px, pyTop);
    }

    ctx.restore();
}
