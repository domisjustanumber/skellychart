/**
 * Matches origin-sheet banner vertical extent in `pdfDocument.ts` so tiling reserves the same
 * height as the rendered PDF (instead of a flat {@link ORIGIN_PAGE_EXTRA_MM} slab).
 */
import {
    CHARUCO_PRINT_LABEL_SPEC_VERSION,
    MM_MARGIN_SHEET,
    MM_ORIGIN_BANNER_BELOW_GAP_MM,
    ORIGIN_BANNER_CONTENT_SIDE_MM,
    ORIGIN_BANNER_CONTENT_TOP_MM,
    ORIGIN_BANNER_STRIP_FALLBACK_NO_CANVAS_LANDSCAPE_MM,
    ORIGIN_BANNER_TEXT_BASELINE_OFFSET_MM,
    ORIGIN_BANNER_VISUAL_SCALE,
    ORIGIN_GAP_BOARD_INFO_TO_INSTRUCTIONS_MM,
    ORIGIN_GAP_QR_TO_BOARD_INFO_MM,
    ORIGIN_GAP_SKELLY_TO_INSTRUCTIONS_MM,
    ORIGIN_PAGE_EXTRA_MM,
    OPENCV_LABEL_VERSION,
    PIXELS_PER_MM,
    QR_SIZE_MM,
    SKELLY_TOP_HEIGHT_MM,
} from './constants.js';
import {originChartInfoParts, pdfLabels} from './labels.js';

/** Matches `public/freemocap-logo.svg` — width/height used for nested `<svg viewBox>` on the print sheet. */
export const SKELLY_LOGO_VIEWBOX_W = 461.4;
export const SKELLY_LOGO_VIEWBOX_H = 584.5;
/** Natural aspect for layout when only height in mm is fixed. */
export const SKELLY_LOGO_NATURAL_W_OVER_H = SKELLY_LOGO_VIEWBOX_W / SKELLY_LOGO_VIEWBOX_H;

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
    /**
     * Distinguishes portrait- vs landscape-shaped sheets only for **no-canvas** and insufficient-width
     * fallbacks (slab constants). Layout matches `svgAssemblyCore`: one top-aligned banner row on both.
     */
    portraitQrAboveCharucoInfo?: boolean;
}

/**
 * Millimetres from the **top of the printable area** (below the sheet margin) down through the
 * banner block and {@link MM_ORIGIN_BANNER_BELOW_GAP_MM}, matching `svgAssemblyCore` placement.
 * Without a canvas (Node / feasibility codegen), uses {@link ORIGIN_PAGE_EXTRA_MM} when the sheet
 * is portrait-shaped vs {@link ORIGIN_BANNER_STRIP_FALLBACK_NO_CANVAS_LANDSCAPE_MM} when landscape-shaped —
 * **not** a single 77 mm slab for both, or landscape tiling max square length is far too small.
 */
export function estimateOriginBannerStripFromPrintableTopMm(params: OriginBannerStripEstimateParams): number {
    const ppm = params.ppm ?? PIXELS_PER_MM;
    const ctx = getScratchContext(params.paperWMm * ppm);
    if (!ctx) {
        return params.portraitQrAboveCharucoInfo === true
            ? ORIGIN_PAGE_EXTRA_MM
            : ORIGIN_BANNER_STRIP_FALLBACK_NO_CANVAS_LANDSCAPE_MM;
    }

    const pagePxW = Math.max(1, Math.round(params.paperWMm * ppm));
    const marginPx = layoutIntPx(MM_MARGIN_SHEET * ppm);
    const sidePad = Math.round(ORIGIN_BANNER_CONTENT_SIDE_MM * ppm);
    const topPad = Math.round(ORIGIN_BANNER_CONTENT_TOP_MM * ppm);
    const bannerLeft = marginPx + sidePad;
    const bannerRightInner = pagePxW - marginPx - sidePad;
    const qrY = marginPx + topPad;
    const qrWidthPx = Math.max(32, Math.round(QR_SIZE_MM * ppm));
    const bannerTitleTop = qrY;
    const bannerTextTop =
        bannerTitleTop + Math.round(ORIGIN_BANNER_TEXT_BASELINE_OFFSET_MM * ppm);
    const gapBoardQr = Math.round(ORIGIN_GAP_QR_TO_BOARD_INFO_MM * ppm);
    const gapInstBoard = Math.round(ORIGIN_GAP_BOARD_INFO_TO_INSTRUCTIONS_MM * ppm);
    const gapSkellyInst = Math.round(ORIGIN_GAP_SKELLY_TO_INSTRUCTIONS_MM * ppm);

    const nh = Math.max(1, Math.round(SKELLY_TOP_HEIGHT_MM * ppm));
    const skellyW = Math.max(1, Math.round(SKELLY_LOGO_NATURAL_W_OVER_H * nh));
    const skellyH = nh;

    const qrX = bannerRightInner - qrWidthPx;
    const qrStackY = bannerTitleTop;
    const instrLeft = bannerLeft + skellyW + (skellyW > 0 ? gapSkellyInst : 0);
    const boardMetaTitleY = bannerTextTop;
    const minInstColPx = Math.max(1, Math.round(12 * ppm));

    const boardInfoRight = qrX - gapBoardQr;
    const boardColMaxW = Math.max(1, boardInfoRight - instrLeft - gapInstBoard - minInstColPx);

    const bScale = ORIGIN_BANNER_VISUAL_SCALE;
    const titleFontPx = Math.round(24 * (ppm / 12) * bScale);
    const bodyFontPx = Math.round(26 * (ppm / 12) * bScale);
    const bodyLineLead = bodyFontPx + Math.max(4, Math.round(0.52 * ppm * bScale));

    const {titleLine: boardTitle, bodyBlock: boardInfoBody} = originChartInfoParts({
        version: CHARUCO_PRINT_LABEL_SPEC_VERSION,
        mm: params.squareLengthMm,
        squaresX: params.squaresX,
        squaresY: params.squaresY,
        opencv_version: OPENCV_LABEL_VERSION,
        dictionary_name: 'DICT_4X4_250',
    });

    ctx.font = `${bodyFontPx}px system-ui, Segoe UI, sans-serif`;
    const boardInfoLines = wrapText(ctx, boardInfoBody, boardColMaxW);
    const vGap = Math.max(4, Math.round(ppm * bScale));
    let by = boardMetaTitleY + titleFontPx + vGap;
    ctx.font = `bold ${titleFontPx}px system-ui, Segoe UI, sans-serif`;
    let infoLeft = boardInfoRight - ctx.measureText(boardTitle).width;
    ctx.font = `${bodyFontPx}px system-ui, Segoe UI, sans-serif`;
    for (const line of boardInfoLines) {
        const w = ctx.measureText(line).width;
        infoLeft = Math.min(infoLeft, boardInfoRight - w);
        by += bodyLineLead;
    }
    const lineBoardBottom = by;

    ctx.textAlign = 'left';
    const instructionAllowRight = infoLeft - gapInstBoard;
    if (instructionAllowRight - instrLeft < minInstColPx) {
        return params.portraitQrAboveCharucoInfo === true
            ? ORIGIN_PAGE_EXTRA_MM
            : ORIGIN_BANNER_STRIP_FALLBACK_NO_CANVAS_LANDSCAPE_MM;
    }

    ctx.font = `bold ${titleFontPx}px system-ui, Segoe UI, sans-serif`;
    const titleBB = titleFontPx;
    const bodyY = bannerTextTop + titleBB + vGap;
    ctx.font = `${bodyFontPx}px system-ui, Segoe UI, sans-serif`;
    const colW = instructionAllowRight - instrLeft;
    const instLines = wrapText(ctx, pdfLabels.originInstructionsBody, colW);
    let iy = bodyY;
    for (let i = 0; i < instLines.length; i++) {
        iy += bodyLineLead;
    }
    const instBottom = iy;

    const qrBottom = qrStackY + qrWidthPx;
    const skellyBottomExtra = skellyW > 0 ? bannerTitleTop + skellyH : bannerTitleTop;

    const bannerBottomPx =
        Math.max(lineBoardBottom, instBottom, qrBottom, skellyBottomExtra) +
        Math.round(MM_ORIGIN_BANNER_BELOW_GAP_MM * ppm);

    const stripPx = bannerBottomPx - marginPx;
    return stripPx / ppm;
}
