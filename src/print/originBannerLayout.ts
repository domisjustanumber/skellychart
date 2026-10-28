/**
 * Origin-sheet banner geometry (logo, instructions, chart info, QR), shared by the sheet renderer and
 * `scripts/generate-banner-size.ts`, which sizes the reserved banner strip from this same layout. The
 * compact variant (print-shop boards: logo, chart info and QR, no instructions) is laid out in a given box
 * and sized at runtime with {@link compactBannerHeightMm}, never from the generated strip table.
 *
 * Text is measured with fixed Helvetica metrics rather than a browser canvas, so the banner wraps
 * identically on every device and in both Print and Save as PDF, and the generated strip height is
 * exactly the rendered banner height.
 */
import {
    MM_ORIGIN_BANNER_BELOW_GAP_MM,
    ORIGIN_BANNER_CONTENT_SIDE_MM,
    ORIGIN_BANNER_CONTENT_TOP_MM,
    ORIGIN_BANNER_TEXT_BASELINE_OFFSET_MM,
    ORIGIN_GAP_BOARD_INFO_TO_INSTRUCTIONS_MM,
    ORIGIN_GAP_QR_TO_BOARD_INFO_MM,
    ORIGIN_GAP_SKELLY_TO_INSTRUCTIONS_MM,
    ORIGIN_WRITE_IN_BOX_GAP_MM,
    ORIGIN_WRITE_IN_BOX_H_MM,
    ORIGIN_WRITE_IN_BOX_W_MM,
    PIXELS_PER_MM,
    QR_SIZE_MM,
} from './constants.js';
import {helveticaTextWidthPx} from './helveticaMetrics.js';
import {sheetSafeMarginsMm} from './sheetGeometry.js';
import {ORIGIN_WRITE_IN_BOX_MARK, originChartInfoParts, pdfLabels} from './labels.js';

export interface OriginBannerLayoutParams {
    /** `full` (default): home sheets, inside the sheet's safe margins. `compact`: print-shop boards, in {@link box}. */
    variant?: 'full' | 'compact';
    /** Compact only: the banner's box in px (the shop content block); it replaces the sheet's safe margins. */
    box?: {leftPx: number; rightPx: number; topPx: number};
    /**
     * Cap height (em) of the face the banner is drawn in, for centring the write-in label on its box:
     * 0.718 for Helvetica (default); outlined shop text passes `GLYPH_CAP_HEIGHT_EM`.
     */
    capHeightEm?: number;
    /** Sheet size (mm) as printed, after any landscape swap; the full banner fills its safe margins. */
    paperWMm: number;
    paperHMm: number;
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
    /** Instructions column text; defaults to the single-sheet `pdfLabels.originInstructionsBody`. */
    instructionsBody?: string;
}

export interface OriginBannerLayout {
    titleFontPx: number;
    bodyFontPx: number;
    bodyLineLead: number;
    /** Gap between a column title and its first body line. */
    vGap: number;
    /** Safe top margin (px) the banner starts at; {@link originBannerStripPx} measures from here. */
    marginTopPx: number;
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
    /** Chart-info body text, each piece right-aligned at `right` with its `hanging` baseline at `y`. */
    boardInfoLines: {text: string; right: number; y: number}[];
    /** Empty box for writing the measured square length in; `null` if the label has no box. */
    writeInBox: {x: number; y: number; w: number; h: number} | null;
    /** Left edge of the widest chart-info line. */
    infoLeft: number;
    /** Bottom of the chart-info column. */
    infoBottom: number;
    instrLeft: number;
    /** `hanging` baseline of the first instruction body line. */
    instBodyY: number;
    instLines: string[];
    /** Bottom of the banner including the gap below it (px from the sheet top). */
    bottom: number;
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
 * columns do not fit side by side at that scale, or (compact) when a chart-info line would wrap.
 */
export function layoutOriginBanner(params: OriginBannerLayoutParams): OriginBannerLayout | null {
    const {paperWMm, paperHMm, typeScale, version, squareLengthMm, squaresX, squaresY, logoWidthPx, logoHeightPx} =
        params;
    const ppm = params.ppm ?? PIXELS_PER_MM;
    const compact = params.variant === 'compact';
    if (compact && !params.box) {
        throw new Error('A compact banner needs a box.');
    }
    const margins = compact ? null : sheetSafeMarginsMm(paperWMm, paperHMm);
    const marginTopPx = margins ? Math.ceil(margins.top * ppm) : params.box!.topPx;
    const bodyFontPx = Math.round(26 * (ppm / 12) * typeScale);
    const titleFontPx = Math.round(24 * (ppm / 12) * typeScale);
    const bodyLineLead = bodyFontPx + Math.max(4, Math.round(0.52 * ppm * typeScale));
    const vGap = Math.max(4, Math.round(ppm * typeScale));
    const sidePad = Math.round(ORIGIN_BANNER_CONTENT_SIDE_MM * ppm);
    const bannerLeft = margins ? Math.ceil(margins.left * ppm) + sidePad : params.box!.leftPx;
    // Rounded inwards from the exact sheet size (Letter and Tabloid are not whole px).
    const bannerRightInner = margins ? Math.floor((paperWMm - margins.right) * ppm) - sidePad : params.box!.rightPx;
    const bannerTitleTop = marginTopPx + Math.round(ORIGIN_BANNER_CONTENT_TOP_MM * ppm);
    const bannerTextTop = bannerTitleTop + Math.round(ORIGIN_BANNER_TEXT_BASELINE_OFFSET_MM * ppm);
    const qrSizePx = Math.max(32, Math.round(QR_SIZE_MM * ppm));
    const qrX = bannerRightInner - qrSizePx;
    const gapInstBoard = Math.round(ORIGIN_GAP_BOARD_INFO_TO_INSTRUCTIONS_MM * ppm);
    const instrLeft =
        bannerLeft + logoWidthPx + (logoWidthPx > 0 ? Math.round(ORIGIN_GAP_SKELLY_TO_INSTRUCTIONS_MM * ppm) : 0);
    // The compact banner has no instructions column, so chart info may run up to the logo.
    const minInstColPx = compact ? 0 : Math.max(1, Math.round(12 * ppm));

    // The chart-info block is right-anchored at `boardInfoRight`, so it grows left into the
    // instructions column instead of toward the QR code.
    const boardInfoRight = qrX - Math.round(ORIGIN_GAP_QR_TO_BOARD_INFO_MM * ppm);
    const boardColMaxW = compact
        ? boardInfoRight - instrLeft
        : Math.max(1, boardInfoRight - instrLeft - gapInstBoard - minInstColPx);
    const {titleLine: boardTitle, bodyBlock: boardInfoBody} = originChartInfoParts({
        version,
        mm: squareLengthMm,
        squaresX,
        squaresY,
    });
    const boardInfoLines: OriginBannerLayout['boardInfoLines'] = [];
    let writeInBox: OriginBannerLayout['writeInBox'] = null;
    let infoLeft = boardInfoRight - helveticaTextWidthPx(boardTitle, titleFontPx, true);
    let y = bannerTextTop + titleFontPx + vGap;
    for (const para of boardInfoBody.split('\n')) {
        const markAt = para.indexOf(ORIGIN_WRITE_IN_BOX_MARK);
        if (markAt === -1) {
            const lines = wrapHelvetica(para, bodyFontPx, false, boardColMaxW);
            if (compact && lines.length > 1) {
                return null;
            }
            for (const line of lines) {
                boardInfoLines.push({text: line, right: boardInfoRight, y});
                infoLeft = Math.min(infoLeft, boardInfoRight - helveticaTextWidthPx(line, bodyFontPx));
                y += bodyLineLead;
            }
            continue;
        }
        // "label [box] unit" on one line, the text centred on the box: right to left from the anchor.
        const before = para.slice(0, markAt).trim();
        const after = para.slice(markAt + ORIGIN_WRITE_IN_BOX_MARK.length).trim();
        const gap = Math.round(ORIGIN_WRITE_IN_BOX_GAP_MM * ppm);
        const w = Math.round(ORIGIN_WRITE_IN_BOX_W_MM * ppm);
        const h = Math.round(ORIGIN_WRITE_IN_BOX_H_MM * ppm);
        const boxTop = y + gap;
        // The `hanging` baseline sits at the cap top (0.718 em for Helvetica).
        const textY = boxTop + Math.round((h - (params.capHeightEm ?? 0.718) * bodyFontPx) / 2);
        let right = boardInfoRight;
        if (after) {
            boardInfoLines.push({text: after, right, y: textY});
            right -= helveticaTextWidthPx(after, bodyFontPx) + gap;
        }
        writeInBox = {x: right - w, y: boxTop, w, h};
        right -= w + gap;
        if (before) {
            boardInfoLines.push({text: before, right, y: textY});
            right -= helveticaTextWidthPx(before, bodyFontPx);
        }
        infoLeft = Math.min(infoLeft, right);
        y = boxTop + h + gap + (bodyLineLead - bodyFontPx);
    }
    const infoBottom = y;

    const instBodyY = bannerTextTop + titleFontPx + vGap;
    let instLines: string[] = [];
    if (compact) {
        if (infoLeft < instrLeft) {
            return null;
        }
    } else {
        const instructionAllowRight = infoLeft - gapInstBoard;
        if (instructionAllowRight - instrLeft < minInstColPx) {
            return null;
        }
        instLines = wrapHelvetica(
            params.instructionsBody ?? pdfLabels.originInstructionsBody,
            bodyFontPx,
            false,
            instructionAllowRight - instrLeft,
        );
    }
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
        marginTopPx,
        bannerLeft,
        bannerTitleTop,
        bannerTextTop,
        qrX,
        qrSizePx,
        boardInfoRight,
        boardTitle,
        boardInfoLines,
        writeInBox,
        infoLeft,
        infoBottom,
        instrLeft,
        instBodyY,
        instLines,
        bottom,
    };
}

/** Banner strip (px) from the safe top margin through the gap below the banner. */
export function originBannerStripPx(layout: OriginBannerLayout): number {
    return layout.bottom - layout.marginTopPx;
}

/** Inputs that set a compact banner's size: everything but its box. */
export type CompactBannerParams = Omit<
    OriginBannerLayoutParams,
    'variant' | 'box' | 'paperWMm' | 'paperHMm' | 'instructionsBody'
>;

const COMPACT_PROBE_RIGHT_PX = 1e6;

function layoutCompactProbe(params: CompactBannerParams): OriginBannerLayout {
    const layout = layoutOriginBanner({
        ...params,
        paperWMm: 0,
        paperHMm: 0,
        variant: 'compact',
        box: {leftPx: 0, rightPx: COMPACT_PROBE_RIGHT_PX, topPx: 0},
    });
    if (!layout) {
        throw new Error('Compact banner does not lay out even on an unbounded width.');
    }
    return layout;
}

/** Narrowest box (px) the compact banner fits without wrapping: logo, gap, widest chart-info line, gap, QR. */
export function compactBannerMinWidthPx(params: CompactBannerParams): number {
    const layout = layoutCompactProbe(params);
    return Math.ceil(layout.instrLeft + (COMPACT_PROBE_RIGHT_PX - layout.infoLeft));
}

/** Compact banner height (mm) from its top through the gap below it; it does not depend on the box width. */
export function compactBannerHeightMm(params: CompactBannerParams): number {
    return layoutCompactProbe(params).bottom / (params.ppm ?? PIXELS_PER_MM);
}
