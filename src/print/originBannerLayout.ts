/**
 * Origin-sheet banner geometry (logo, instructions, chart info, QR), shared by the sheet renderer and
 * tiling, which reserves a single-sheet chart's banner strip from this same layout
 * ({@link originBannerReserveMm}). The compact variant (print-shop boards: logo, chart info and QR, no
 * instructions) is laid out in a given box and sized with {@link compactBannerHeightMm}.
 *
 * Text is measured with fixed Helvetica metrics rather than a browser canvas, so the banner wraps
 * identically on every device and in both Print and Save as PDF, and the reserved strip is exactly the
 * rendered banner height.
 */
import {APP_VERSION_DISPLAY} from '../appVersion.js';
import {
    BOARD_GRID_MAX,
    CHARUCO_SQUARE_MM_MAX,
    MM_ORIGIN_BANNER_BELOW_GAP_MM,
    ORIGIN_BANNER_TEXT_BASELINE_OFFSET_MM,
    ORIGIN_BANNER_VISUAL_SCALE,
    ORIGIN_GAP_BOARD_INFO_TO_INSTRUCTIONS_MM,
    ORIGIN_GAP_QR_TO_BOARD_INFO_MM,
    ORIGIN_GAP_SKELLY_TO_INSTRUCTIONS_MM,
    ORIGIN_WRITE_IN_BOX_GAP_MM,
    ORIGIN_WRITE_IN_BOX_H_MM,
    ORIGIN_WRITE_IN_BOX_W_MM,
    PIXELS_PER_MM,
    QR_SIZE_MM,
    SKELLY_TOP_HEIGHT_MM,
} from './constants.js';
import {HELVETICA_CAP_HEIGHT_EM, helveticaTextWidthPx} from './helveticaMetrics.js';
import {sheetSafeRectPx} from './sheetGeometry.js';
import {interpolate, pdfLabels} from './labels.js';
import {SKELLY_LOGO_NATURAL_W_OVER_H} from './skellyLogo.js';

const bannerBodyFontPx = Math.round(26 * (PIXELS_PER_MM / 12) * ORIGIN_BANNER_VISUAL_SCALE);

/** Banner type (px at `PIXELS_PER_MM`); the assembly guide's own text is set in its body size too. */
export const BANNER_TYPE_PX = {
    titleFontPx: Math.round(24 * (PIXELS_PER_MM / 12) * ORIGIN_BANNER_VISUAL_SCALE),
    bodyFontPx: bannerBodyFontPx,
    bodyLineLead: bannerBodyFontPx + Math.max(4, Math.round(0.52 * PIXELS_PER_MM * ORIGIN_BANNER_VISUAL_SCALE)),
    /** Gap between a column title and its first body line. */
    vGap: Math.max(4, Math.round(PIXELS_PER_MM * ORIGIN_BANNER_VISUAL_SCALE)),
};

/** QR code side (px at `PIXELS_PER_MM`) on every banner. */
export const BANNER_QR_PX = Math.max(32, Math.round(QR_SIZE_MM * PIXELS_PER_MM));

const bannerLogoHeightPx = Math.max(1, Math.round(SKELLY_TOP_HEIGHT_MM * PIXELS_PER_MM));

/** Logo box (px at `PIXELS_PER_MM`) on every banner: fixed height, natural aspect of `public/freemocap-logo.svg`. */
export const BANNER_LOGO_PX = {
    widthPx: Math.max(1, Math.round(SKELLY_LOGO_NATURAL_W_OVER_H * bannerLogoHeightPx)),
    heightPx: bannerLogoHeightPx,
};

export interface OriginBannerLayoutParams {
    /** `full` (default): home sheets, inside the sheet's safe margins. `compact`: print-shop boards, in {@link box}. */
    variant?: 'full' | 'compact';
    /**
     * The banner's box in px, in place of the sheet's safe margins: needed by compact (the shop content
     * block); a full banner takes one on an assembly guide drawn turned on its sheet.
     */
    box?: {leftPx: number; rightPx: number; topPx: number};
    /**
     * Full only, and needed there: whose measuring line the instructions carry, `chart` on a single-sheet
     * chart or `guide` on a multi-sheet chart's assembly guide.
     */
    instructions?: 'chart' | 'guide';
    /**
     * Cap height (em) of the face the banner is drawn in, for centring the write-in label on its box:
     * `HELVETICA_CAP_HEIGHT_EM` (default); outlined shop text passes `GLYPH_CAP_HEIGHT_EM`.
     */
    capHeightEm?: number;
    /** Sheet size (mm) as printed, after any landscape swap; the full banner fills its safe margins. */
    paperWMm: number;
    paperHMm: number;
    /** Version as printed in the chart-info title (`APP_VERSION_DISPLAY`). */
    version: string;
    squareLengthMm: number;
    squaresX: number;
    squaresY: number;
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
    /**
     * Logo box at `bannerLeft`, `bannerTitleTop`. It is kept when the logo did not load, so the banner is
     * still the height tiling reserved.
     */
    logoWidthPx: number;
    logoHeightPx: number;
    qrX: number;
    qrSizePx: number;
    /** Right edge the chart-info block is anchored to. */
    boardInfoRight: number;
    boardTitle: string;
    /** Chart-info body text, each piece right-aligned at `right` with its `hanging` baseline at `y`. */
    boardInfoLines: {text: string; right: number; y: number}[];
    /** Empty box for writing the measured square length in. */
    writeInBox: {x: number; y: number; w: number; h: number};
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

/**
 * Lay out the origin banner. Throws when the instruction and chart-info columns do not fit side by side,
 * or (compact) when a chart-info line would wrap in its box.
 */
export function layoutOriginBanner(params: OriginBannerLayoutParams): OriginBannerLayout {
    const {paperWMm, paperHMm, version, squareLengthMm, squaresX, squaresY} = params;
    const ppm = PIXELS_PER_MM;
    const compact = params.variant === 'compact';
    if (compact && !params.box) {
        throw new Error('A compact banner needs a box.');
    }
    if (!compact && !params.instructions) {
        throw new Error('A full banner needs its instructions.');
    }
    const safe = params.box ? null : sheetSafeRectPx(paperWMm, paperHMm, ppm);
    const marginTopPx = safe ? safe.top : params.box!.topPx;
    const {titleFontPx, bodyFontPx, bodyLineLead, vGap} = BANNER_TYPE_PX;
    const bannerLeft = safe ? safe.left : params.box!.leftPx;
    const bannerRightInner = safe ? safe.right : params.box!.rightPx;
    const bannerTitleTop = marginTopPx;
    const bannerTextTop = bannerTitleTop + Math.round(ORIGIN_BANNER_TEXT_BASELINE_OFFSET_MM * ppm);
    const {widthPx: logoWidthPx, heightPx: logoHeightPx} = BANNER_LOGO_PX;
    const qrSizePx = BANNER_QR_PX;
    const qrX = bannerRightInner - qrSizePx;
    const gapInstBoard = Math.round(ORIGIN_GAP_BOARD_INFO_TO_INSTRUCTIONS_MM * ppm);
    const instrLeft = bannerLeft + logoWidthPx + Math.round(ORIGIN_GAP_SKELLY_TO_INSTRUCTIONS_MM * ppm);
    // The compact banner has no instructions column, so chart info may run up to the logo.
    const minInstColPx = compact ? 0 : Math.max(1, Math.round(12 * ppm));
    const chart = `${squareLengthMm} mm, ${squaresX}×${squaresY}, v${version}`;

    // The chart-info block is right-anchored at `boardInfoRight`, so it grows left into the
    // instructions column instead of toward the QR code.
    const boardInfoRight = qrX - Math.round(ORIGIN_GAP_QR_TO_BOARD_INFO_MM * ppm);
    const boardColMaxW = compact
        ? boardInfoRight - instrLeft
        : Math.max(1, boardInfoRight - instrLeft - gapInstBoard - minInstColPx);
    const info = pdfLabels.originChartInfo;
    const vars = {version, mm: squareLengthMm, squaresX, squaresY};
    const boardTitle = interpolate(info.title, vars);
    const boardInfoLines: OriginBannerLayout['boardInfoLines'] = [];
    let infoLeft = boardInfoRight - helveticaTextWidthPx(boardTitle, titleFontPx, true);
    let y = bannerTextTop + titleFontPx + vGap;
    for (const para of info.lines) {
        const lines = wrapHelvetica(interpolate(para, vars), bodyFontPx, false, boardColMaxW);
        if (compact && lines.length > 1) {
            throw new Error(`The compact banner's chart info wraps in its box (${chart}).`);
        }
        for (const line of lines) {
            boardInfoLines.push({text: line, right: boardInfoRight, y});
            infoLeft = Math.min(infoLeft, boardInfoRight - helveticaTextWidthPx(line, bodyFontPx));
            y += bodyLineLead;
        }
    }
    // "label [box] unit" on one line, the text centred on the box: right to left from the anchor.
    const {before, after} = info.writeIn;
    const gap = Math.round(ORIGIN_WRITE_IN_BOX_GAP_MM * ppm);
    const w = Math.round(ORIGIN_WRITE_IN_BOX_W_MM * ppm);
    const h = Math.round(ORIGIN_WRITE_IN_BOX_H_MM * ppm);
    const boxTop = y + gap;
    // The `hanging` baseline sits at the cap top.
    const textY = boxTop + Math.round((h - (params.capHeightEm ?? HELVETICA_CAP_HEIGHT_EM) * bodyFontPx) / 2);
    let right = boardInfoRight;
    boardInfoLines.push({text: after, right, y: textY});
    right -= helveticaTextWidthPx(after, bodyFontPx) + gap;
    const writeInBox = {x: right - w, y: boxTop, w, h};
    right -= w + gap;
    boardInfoLines.push({text: before, right, y: textY});
    right -= helveticaTextWidthPx(before, bodyFontPx);
    infoLeft = Math.min(infoLeft, right);
    const infoBottom = boxTop + h + gap + (bodyLineLead - bodyFontPx);

    const instBodyY = bannerTextTop + titleFontPx + vGap;
    let instLines: string[] = [];
    if (compact) {
        if (infoLeft < instrLeft) {
            throw new Error(`The compact banner's chart info runs into the logo (${chart}).`);
        }
    } else {
        const instructionAllowRight = infoLeft - gapInstBoard;
        if (instructionAllowRight - instrLeft < minInstColPx) {
            throw new Error(
                `Origin banner columns do not fit side by side on a ${paperWMm}×${paperHMm} mm sheet (${chart}); shorten the chart-info text or reduce the gaps.`,
            );
        }
        const measure = params.instructions === 'guide' ? pdfLabels.originMeasureGuide : pdfLabels.originMeasureChart;
        instLines = wrapHelvetica(
            interpolate(pdfLabels.originInstructionsBody, {measure}),
            bodyFontPx,
            false,
            instructionAllowRight - instrLeft,
        );
    }
    const instBottom = instBodyY + instLines.length * bodyLineLead;

    const qrBottom = bannerTitleTop + qrSizePx;
    const logoBottom = bannerTitleTop + logoHeightPx;
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
        logoWidthPx,
        logoHeightPx,
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

/** Reserved strips (mm) by sheet size; the version is fixed for the whole run, so the size is the key. */
const reserveMmBySheet = new Map<string, number>();

/**
 * Origin-banner strip (mm, from the safe top margin through the gap below the banner) on a sheet this
 * size. Tiling (`tiling.ts`, and so `feasibilityRules.ts`) reserves it above a single-sheet chart and the
 * renderer (`svgAssemblyCore.ts`) draws the banner in it, so the sheet count shown in the UI is the sheet
 * count printed. It is the banner laid out for the largest grid and square length: Helvetica digits all
 * have the same width, so those give the widest chart info and the narrowest instructions column, and
 * so the tallest banner. `npm run check:banner` proves every chart's banner is exactly this tall.
 */
export function originBannerReserveMm(paperWMm: number, paperHMm: number): number {
    const key = `${paperWMm}x${paperHMm}`;
    let mm = reserveMmBySheet.get(key);
    if (mm === undefined) {
        const layout = layoutOriginBanner({
            instructions: 'chart',
            paperWMm,
            paperHMm,
            version: APP_VERSION_DISPLAY,
            squareLengthMm: CHARUCO_SQUARE_MM_MAX,
            squaresX: BOARD_GRID_MAX,
            squaresY: BOARD_GRID_MAX,
        });
        mm = originBannerStripPx(layout) / PIXELS_PER_MM;
        reserveMmBySheet.set(key, mm);
    }
    return mm;
}

/** Inputs that set a compact banner's size: everything but its box. */
export type CompactBannerParams = Omit<
    OriginBannerLayoutParams,
    'variant' | 'box' | 'paperWMm' | 'paperHMm' | 'instructions'
>;

const COMPACT_PROBE_RIGHT_PX = 1e6;

function layoutCompactProbe(params: CompactBannerParams): OriginBannerLayout {
    return layoutOriginBanner({
        ...params,
        paperWMm: 0,
        paperHMm: 0,
        variant: 'compact',
        box: {leftPx: 0, rightPx: COMPACT_PROBE_RIGHT_PX, topPx: 0},
    });
}

/** Narrowest box (px) the compact banner fits without wrapping: logo, gap, widest chart-info line, gap, QR. */
export function compactBannerMinWidthPx(params: CompactBannerParams): number {
    const layout = layoutCompactProbe(params);
    return Math.ceil(layout.instrLeft + (COMPACT_PROBE_RIGHT_PX - layout.infoLeft));
}

/** Compact banner height (mm) from its top through the gap below it; it does not depend on the box width. */
export function compactBannerHeightMm(params: CompactBannerParams): number {
    return layoutCompactProbe(params).bottom / PIXELS_PER_MM;
}
