/**
 * Matches origin-sheet banner vertical extent in `pdfDocument.ts` so tiling reserves the same
 * height as the rendered PDF (instead of a flat {@link ORIGIN_PAGE_EXTRA_MM} slab).
 */
import {
    MM_MARGIN_SHEET,
    MM_ORIGIN_BANNER_BELOW_GAP_MM,
    ORIGIN_BANNER_CONTENT_SIDE_MM,
    ORIGIN_BANNER_CONTENT_TOP_MM,
    ORIGIN_GAP_BOARD_INFO_TO_INSTRUCTIONS_MM,
    ORIGIN_GAP_QR_TO_BOARD_INFO_MM,
    ORIGIN_GAP_SKELLY_TO_INSTRUCTIONS_MM,
    ORIGIN_PAGE_EXTRA_MM,
    OPENCV_LABEL_VERSION,
    PIXELS_PER_MM,
    QR_SIZE_MM,
    SKELLY_TOP_HEIGHT_MM,
} from './constants.js';
import {interpolate, pdfLabels} from './labels.js';

/** `viewBox` aspect from `public/freemocap-logo.svg` — keeps logo width in sync with PDF raster sizing. */
const SKELLY_LOGO_NATURAL_W_OVER_H = 461.4 / 584.5;

function layoutIntPx(x: number): number {
    return Math.max(0, Math.floor(x));
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

let scratchCanvas: HTMLCanvasElement | undefined;
let scratchCanvasW = 0;

function getScratchContext(pagePxW: number): CanvasRenderingContext2D | null {
    if (typeof document === 'undefined') {
        return null;
    }
    try {
        const w = Math.max(64, Math.ceil(pagePxW));
        if (!scratchCanvas || scratchCanvasW < w) {
            scratchCanvas = document.createElement('canvas');
            scratchCanvas.width = w;
            scratchCanvas.height = Math.max(512, Math.ceil(120 * (PIXELS_PER_MM / 12)));
            scratchCanvasW = w;
        }
        return scratchCanvas.getContext('2d');
    } catch {
        return null;
    }
}

export interface OriginBannerStripEstimateParams {
    /** Effective PDF page width (mm), after orientation swap if landscape. */
    paperWMm: number;
    squaresX: number;
    squaresY: number;
    squareLengthMm: number;
    /** Pixels per mm — must match PDF rasterization (`PIXELS_PER_MM`). */
    ppm?: number;
}

/**
 * Millimetres from the **top of the printable area** (below the sheet margin) down through the
 * banner block and {@link MM_ORIGIN_BANNER_BELOW_GAP_MM}, matching `pdfDocument.ts` placement.
 * Falls back to {@link ORIGIN_PAGE_EXTRA_MM} when canvas measurement is unavailable.
 */
export function estimateOriginBannerStripFromPrintableTopMm(params: OriginBannerStripEstimateParams): number {
    const ppm = params.ppm ?? PIXELS_PER_MM;
    const ctx = getScratchContext(params.paperWMm * ppm);
    if (!ctx) {
        return ORIGIN_PAGE_EXTRA_MM;
    }

    const pagePxW = Math.max(1, Math.round(params.paperWMm * ppm));
    const marginPx = layoutIntPx(MM_MARGIN_SHEET * ppm);
    const sidePad = Math.round(ORIGIN_BANNER_CONTENT_SIDE_MM * ppm);
    const topPad = Math.round(ORIGIN_BANNER_CONTENT_TOP_MM * ppm);
    const bannerLeft = marginPx + sidePad;
    const bannerRightInner = pagePxW - marginPx - sidePad;
    const qrY = marginPx + topPad;
    const qrWidthPx = Math.max(32, Math.round(QR_SIZE_MM * ppm));
    const qrX = bannerRightInner - qrWidthPx;
    const bannerTitleTop = qrY;
    const gapBoardQr = Math.round(ORIGIN_GAP_QR_TO_BOARD_INFO_MM * ppm);
    const gapInstBoard = Math.round(ORIGIN_GAP_BOARD_INFO_TO_INSTRUCTIONS_MM * ppm);
    const gapSkellyInst = Math.round(ORIGIN_GAP_SKELLY_TO_INSTRUCTIONS_MM * ppm);
    const boardInfoRight = qrX - gapBoardQr;

    const nh = Math.max(1, Math.round(SKELLY_TOP_HEIGHT_MM * ppm));
    const skellyW = Math.max(1, Math.round(SKELLY_LOGO_NATURAL_W_OVER_H * nh));
    const skellyH = nh;

    const instrLeft = bannerLeft + skellyW + (skellyW > 0 ? gapSkellyInst : 0);
    const minInstColPx = Math.max(1, Math.round(12 * ppm));

    const titleFontPx = Math.round(24 * (ppm / 12));
    const bodyFontPx = Math.round(26 * (ppm / 12));
    const bodyLineLead = bodyFontPx + Math.max(4, Math.round(0.52 * ppm));

    ctx.font = `bold ${titleFontPx}px system-ui, Segoe UI, sans-serif`;

    const boardColMaxW = Math.max(
        1,
        boardInfoRight - instrLeft - gapInstBoard - minInstColPx,
    );
    const boardInfoBlock = [
        interpolate(pdfLabels.originSquareSizeLine, {mm: params.squareLengthMm}),
        interpolate(pdfLabels.originWidthLine, {n: params.squaresX}),
        interpolate(pdfLabels.originHeightLine, {n: params.squaresY}),
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
        by += bodyLineLead;
    }
    const lineBoardBottom = by;

    ctx.textAlign = 'left';
    const instructionAllowRight = infoLeft - gapInstBoard;
    if (instructionAllowRight - instrLeft < minInstColPx) {
        return ORIGIN_PAGE_EXTRA_MM;
    }

    ctx.font = `bold ${titleFontPx}px system-ui, Segoe UI, sans-serif`;
    const titleBB = titleFontPx;
    const bodyY = bannerTitleTop + titleBB + Math.max(4, ppm);
    ctx.font = `${bodyFontPx}px system-ui, Segoe UI, sans-serif`;
    const colW = instructionAllowRight - instrLeft;
    const instLines = wrapText(
        ctx,
        pdfLabels.originInstructions + '\n' + pdfLabels.originInstructionsDocumentationFooter,
        colW,
    );
    let iy = bodyY;
    for (let i = 0; i < instLines.length; i++) {
        iy += bodyLineLead;
    }
    const instBottom = iy;

    const skellyBottomExtra = skellyW > 0 ? qrY + skellyH : qrY;
    const qrBottom = qrY + qrWidthPx;

    const bannerBottomPx =
        Math.max(lineBoardBottom, instBottom, qrBottom, skellyBottomExtra) +
        Math.round(MM_ORIGIN_BANNER_BELOW_GAP_MM * ppm);

    const stripPx = bannerBottomPx - marginPx;
    return stripPx / ppm;
}
