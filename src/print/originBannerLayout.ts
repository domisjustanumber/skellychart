/**
 * Origin-sheet banner geometry (logo, instructions, chart info, QR), shared by the sheet renderer and
 * `scripts/generate-banner-size.ts`, which sizes the reserved banner strip from this same layout.
 *
 * Text is measured with fixed Helvetica metrics rather than a browser canvas, so the banner wraps
 * identically on every device and in both Print and Save as PDF, and the generated strip height is
 * exactly the rendered banner height.
 */
import {
    MM_MARGIN_SHEET,
    MM_ORIGIN_BANNER_BELOW_GAP_MM,
    ORIGIN_BANNER_CONTENT_SIDE_MM,
    ORIGIN_BANNER_CONTENT_TOP_MM,
    ORIGIN_BANNER_TEXT_BASELINE_OFFSET_MM,
    ORIGIN_GAP_BOARD_INFO_TO_INSTRUCTIONS_MM,
    ORIGIN_GAP_QR_TO_BOARD_INFO_MM,
    ORIGIN_GAP_SKELLY_TO_INSTRUCTIONS_MM,
    PIXELS_PER_MM,
    QR_SIZE_MM,
} from './constants.js';
import {helveticaTextWidthPx} from './helveticaMetrics.js';
import {originChartInfoParts, pdfLabels} from './labels.js';

export interface OriginBannerLayoutParams {
    /** Sheet width (mm) as printed, after any landscape swap. */
    paperWMm: number;
    /** Banner type scale (`ORIGIN_BANNER_VISUAL_SCALE` at full size). */
    typeScale: number;
    /** Version as printed in the chart-info title (`APP_VERSION_DISPLAY`). */
    version: string;
    squareLengthMm: number;
    squaresX: number;
    squaresY: number;
    /** Logo box in px; 0 when the logo is unavailable. */
    logoWidthPx: number;
    logoHeightPx: number;
    ppm?: number;
}

export interface OriginBannerLayout {
    titleFontPx: number;
    bodyFontPx: number;
    bodyLineLead: number;
    /** Gap between a column title and its first body line. */
    vGap: number;
    bannerLeft: number;
    /** Top edge of the logo and QR columns (the inner sheet margin). */
    bannerTitleTop: number;
    /** `hanging` baseline of the column titles. */
    bannerTextTop: number;
    qrX: number;
    qrSizePx: number;
    /** Right edge the chart-info block is anchored to. */
    boardInfoRight: number;
    boardTitle: string;
    boardInfoLines: string[];
    instrLeft: number;
    /** `hanging` baseline of the first instruction body line. */
    instBodyY: number;
    instLines: string[];
    /** Bottom of the banner including the gap below it (px from the sheet top). */
    bottom: number;
}

function layoutIntPx(x: number): number {
    return Math.max(0, Math.floor(x));
}

/** Greedy word wrap with Helvetica metrics; a word wider than `maxW` gets a line of its own. */
export function wrapHelvetica(text: string, fontPx: number, bold: boolean, maxW: number): string[] {
    const lines: string[] = [];
    for (const para of text.split('\n')) {
        const stripped = para.trim();
        if (!stripped) {
            lines.push('');
            continue;
        }
        let lineWords: string[] = [];
        for (const w of stripped.split(/\s+/)) {
            const trial = [...lineWords, w].join(' ');
            if (helveticaTextWidthPx(trial, fontPx, bold) <= maxW || lineWords.length === 0) {
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

/** Logo box (px) for the banner: fixed height, natural aspect of `public/freemocap-logo.svg`. */
export function bannerLogoSizePx(heightMm: number, naturalWOverH: number, ppm = PIXELS_PER_MM): {
    widthPx: number;
    heightPx: number;
} {
    const heightPx = Math.max(1, Math.round(heightMm * ppm));
    return {widthPx: Math.max(1, Math.round(naturalWOverH * heightPx)), heightPx};
}

/**
 * Lay out the origin banner at one type scale. Returns `null` when the instruction and chart-info
 * columns do not fit side by side at that scale.
 */
export function layoutOriginBanner(params: OriginBannerLayoutParams): OriginBannerLayout | null {
    const {paperWMm, typeScale, version, squareLengthMm, squaresX, squaresY, logoWidthPx, logoHeightPx} = params;
    const ppm = params.ppm ?? PIXELS_PER_MM;
    const pagePxW = Math.max(1, Math.round(paperWMm * ppm));
    const marginPx = layoutIntPx(MM_MARGIN_SHEET * ppm);
    const bodyFontPx = Math.round(26 * (ppm / 12) * typeScale);
    const titleFontPx = Math.round(24 * (ppm / 12) * typeScale);
    const bodyLineLead = bodyFontPx + Math.max(4, Math.round(0.52 * ppm * typeScale));
    const vGap = Math.max(4, Math.round(ppm * typeScale));
    const sidePad = Math.round(ORIGIN_BANNER_CONTENT_SIDE_MM * ppm);
    const bannerLeft = marginPx + sidePad;
    const bannerRightInner = pagePxW - marginPx - sidePad;
    const bannerTitleTop = marginPx + Math.round(ORIGIN_BANNER_CONTENT_TOP_MM * ppm);
    const bannerTextTop = bannerTitleTop + Math.round(ORIGIN_BANNER_TEXT_BASELINE_OFFSET_MM * ppm);
    const qrSizePx = Math.max(32, Math.round(QR_SIZE_MM * ppm));
    const qrX = bannerRightInner - qrSizePx;
    const gapInstBoard = Math.round(ORIGIN_GAP_BOARD_INFO_TO_INSTRUCTIONS_MM * ppm);
    const instrLeft =
        bannerLeft + logoWidthPx + (logoWidthPx > 0 ? Math.round(ORIGIN_GAP_SKELLY_TO_INSTRUCTIONS_MM * ppm) : 0);
    const minInstColPx = Math.max(1, Math.round(12 * ppm));

    // The chart-info block is right-anchored at `boardInfoRight`, so it grows left into the
    // instructions column instead of toward the QR code.
    const boardInfoRight = qrX - Math.round(ORIGIN_GAP_QR_TO_BOARD_INFO_MM * ppm);
    const boardColMaxW = Math.max(1, boardInfoRight - instrLeft - gapInstBoard - minInstColPx);
    const {titleLine: boardTitle, bodyBlock: boardInfoBody} = originChartInfoParts({
        version,
        mm: squareLengthMm,
        squaresX,
        squaresY,
    });
    const boardInfoLines = wrapHelvetica(boardInfoBody, bodyFontPx, false, boardColMaxW);
    let infoLeft = boardInfoRight - helveticaTextWidthPx(boardTitle, titleFontPx, true);
    for (const line of boardInfoLines) {
        infoLeft = Math.min(infoLeft, boardInfoRight - helveticaTextWidthPx(line, bodyFontPx));
    }
    const infoBottom = bannerTextTop + titleFontPx + vGap + boardInfoLines.length * bodyLineLead;

    const instructionAllowRight = infoLeft - gapInstBoard;
    if (instructionAllowRight - instrLeft < minInstColPx) {
        return null;
    }
    const instBodyY = bannerTextTop + titleFontPx + vGap;
    const instLines = wrapHelvetica(
        pdfLabels.originInstructionsBody,
        bodyFontPx,
        false,
        instructionAllowRight - instrLeft,
    );
    const instBottom = instBodyY + instLines.length * bodyLineLead;

    const qrBottom = bannerTitleTop + qrSizePx;
    const logoBottom = bannerTitleTop + (logoWidthPx > 0 ? logoHeightPx : 0);
    const bottom =
        Math.max(infoBottom, instBottom, qrBottom, logoBottom) + Math.round(MM_ORIGIN_BANNER_BELOW_GAP_MM * ppm);

    return {
        titleFontPx,
        bodyFontPx,
        bodyLineLead,
        vGap,
        bannerLeft,
        bannerTitleTop,
        bannerTextTop,
        qrX,
        qrSizePx,
        boardInfoRight,
        boardTitle,
        boardInfoLines,
        instrLeft,
        instBodyY,
        instLines,
        bottom,
    };
}

/** Banner strip (px) from the top of the printable area through the gap below the banner. */
export function originBannerStripPx(layout: OriginBannerLayout, ppm = PIXELS_PER_MM): number {
    return layout.bottom - layoutIntPx(MM_MARGIN_SHEET * ppm);
}
