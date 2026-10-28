/**
 * The print-shop sheet: one SVG page of trim plus bleed (plus a crop-mark margin and slug when crop marks
 * are on), with the compact banner, the board at exactly 1:1 and the corner marker, and every glyph an
 * outlined path, so the PDF carries no fonts. The same SVG feeds the preview and the PDF.
 *
 * Load this module with `await import()`: it pulls in the glyph outline table.
 */
import {APP_VERSION_DISPLAY} from '../appVersion.js';
import {renderCharucoBoardSvgFragment, type CharucoGeometry} from '../charuco/board.js';
import {buildCharucoDocumentationUrl, type ShopPrintOptions, type ShopSizeChoice} from './charucoDocUrl.js';
import {
    CHARUCO_MARKER_LENGTH_RATIO,
    getCharucoPrintSourceUrl,
    ORIGIN_BANNER_VISUAL_SCALE,
    PIXELS_PER_MM,
    QR_SIZE_MM,
} from './constants.js';
import {GLYPH_CAP_HEIGHT_EM} from './glyphOutlines.generated.js';
import {helveticaTextWidthPx} from './helveticaMetrics.js';
import {interpolate, pdfLabels} from './labels.js';
import {layoutOriginBanner} from './originBannerLayout.js';
import {outlineText} from './outlineText.js';
import {generateQrSvgFragment} from './qrSvg.js';
import type {ShopLayout} from './shopLayout.js';
import {
    bleedMmForUnit,
    formatShopTrim,
    SHOP_CROP_MARK_LENGTH_MM,
    shopMediaMarginMm,
} from './shopSizes.js';
import {svgCharucoBoardInfoBlock, svgCornerMarker} from './svgAssemblyCore.js';
import {resolveLogoForPrint} from './svgDocument.js';
import {SKELLY_LOGO_VIEWBOX_H, SKELLY_LOGO_VIEWBOX_W} from './skellyLogo.js';
import {svgRootOpen, svgRootOuterSizeAttrsUnit, SVG_ROOT_CLOSE} from './svgUtils.js';

/** Crop-mark stroke: 0.25 pt. */
const CROP_MARK_STROKE_MM = (0.25 * 25.4) / 72;
/** Slug type: 6 pt. */
const SLUG_FONT_MM = (6 * 25.4) / 72;
/** Slug baseline below the bleed edge, and its inset from the trim's sides (mm). */
const SLUG_BASELINE_BELOW_BLEED_MM = 3.5;
const SLUG_SIDE_INSET_MM = 3;

/** A box in mm on the page (MediaBox coordinates, from the top-left corner). */
export interface PageBoxMm {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface ShopSheetSvg {
    svg: string;
    mediaMm: {w: number; h: number};
    trimBoxMm: PageBoxMm;
    bleedBoxMm: PageBoxMm;
}

export interface ShopSheetParams {
    squaresX: number;
    squaresY: number;
    squareMm: number;
    layout: ShopLayout;
    size: ShopSizeChoice;
    options: ShopPrintOptions;
    /** Chart link the QR encodes (with the shop `t` field). */
    qrSvgFragment: string;
    logoSvgInner: string;
    logoWidthPx: number;
    logoHeightPx: number;
    version?: string;
}

/** Slug text, dropping parts from the right until it fits `maxWidthPx` (outlined text advances by the AFM widths). */
function slugLine(parts: string[], fontPx: number, maxWidthPx: number): string {
    for (let n = parts.length; n > 0; n--) {
        const line = parts.slice(0, n).join(' | ');
        if (helveticaTextWidthPx(line, fontPx) <= maxWidthPx) {
            return line;
        }
    }
    return '';
}

/** Renders the print-shop sheet for a board already laid out on its size. */
export function renderShopSheetSvg(p: ShopSheetParams): ShopSheetSvg {
    const ppm = PIXELS_PER_MM;
    const {squaresX, squaresY, squareMm, layout, options} = p;
    const version = p.version ?? APP_VERSION_DISPLAY;
    const bleedMm = bleedMmForUnit(options.bleed, p.size.unit);
    const marginMm = shopMediaMarginMm(bleedMm, options.cropMarks);
    const mediaW = layout.trimWMm + 2 * marginMm;
    const mediaH = layout.trimHMm + 2 * marginMm;
    const [widthAttr, heightAttr] = svgRootOuterSizeAttrsUnit(mediaW, mediaH);

    // Content origin on whole px; banner and board keep their exact sizes relative to it.
    const cx = Math.round(layout.content.x * ppm);
    const cy = Math.round(layout.content.y * ppm);
    const contentW = Math.round(layout.content.w * ppm);
    const bannerH = Math.round(layout.banner.h * ppm);
    const boardW = Math.round(squaresX * squareMm * ppm);
    const boardH = Math.round(squaresY * squareMm * ppm);
    const boardX = cx + Math.round((contentW - boardW) / 2);
    const boardY = cy + bannerH;

    const banner = layoutOriginBanner({
        variant: 'compact',
        box: {leftPx: cx, rightPx: cx + contentW, topPx: cy},
        capHeightEm: GLYPH_CAP_HEIGHT_EM,
        paperWMm: 0,
        paperHMm: 0,
        typeScale: ORIGIN_BANNER_VISUAL_SCALE,
        version,
        squareLengthMm: squareMm,
        squaresX,
        squaresY,
        logoWidthPx: p.logoWidthPx,
        logoHeightPx: p.logoHeightPx,
        ppm,
    });
    if (!banner) {
        throw new Error('The compact banner does not fit this board.');
    }

    const geom: CharucoGeometry = {
        squaresX,
        squaresY,
        squareLength: squareMm,
        markerLength: squareMm * CHARUCO_MARKER_LENGTH_RATIO,
    };
    const trimParts = [
        svgCharucoBoardInfoBlock(
            banner.boardInfoRight,
            banner.bannerTextTop,
            banner.boardTitle,
            banner.titleFontPx,
            banner.boardInfoLines,
            banner.bodyFontPx,
            banner.writeInBox,
            ppm,
            outlineText,
        ),
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" x="${banner.bannerLeft}" y="${banner.bannerTitleTop}" width="${p.logoWidthPx}" height="${p.logoHeightPx}" viewBox="0 0 ${SKELLY_LOGO_VIEWBOX_W} ${SKELLY_LOGO_VIEWBOX_H}" preserveAspectRatio="xMidYMin meet" overflow="hidden">${p.logoSvgInner}</svg>`,
        `<svg x="${banner.qrX}" y="${banner.bannerTitleTop}" width="${banner.qrSizePx}" height="${banner.qrSizePx}" overflow="hidden">${p.qrSvgFragment}</svg>`,
        `<svg x="${boardX}" y="${boardY}" width="${boardW}" height="${boardH}" viewBox="0 0 ${boardW} ${boardH}" overflow="hidden">` +
            `<rect width="${boardW}" height="${boardH}" fill="#fff"/>` +
            renderCharucoBoardSvgFragment(boardW, boardH, geom) +
            `</svg>`,
        svgCornerMarker(ppm, boardX, boardY, outlineText),
    ];

    const m = marginMm * ppm;
    const parts = [
        '<rect width="100%" height="100%" fill="#fff"/>',
        `<g transform="translate(${+m.toFixed(3)} ${+m.toFixed(3)})">${trimParts.join('')}</g>`,
    ];
    if (options.cropMarks) {
        const x0 = m;
        const y0 = m;
        const x1 = m + layout.trimWMm * ppm;
        const y1 = m + layout.trimHMm * ppm;
        const near = bleedMm * ppm;
        const far = (bleedMm + SHOP_CROP_MARK_LENGTH_MM) * ppm;
        const n = (v: number) => +v.toFixed(3);
        const d = [
            // Each corner: one mark on each trim edge line, from the bleed edge outward.
            `M${n(x0 - far)} ${n(y0)}H${n(x0 - near)}M${n(x0)} ${n(y0 - far)}V${n(y0 - near)}`,
            `M${n(x1 + near)} ${n(y0)}H${n(x1 + far)}M${n(x1)} ${n(y0 - far)}V${n(y0 - near)}`,
            `M${n(x0 - far)} ${n(y1)}H${n(x0 - near)}M${n(x0)} ${n(y1 + near)}V${n(y1 + far)}`,
            `M${n(x1 + near)} ${n(y1)}H${n(x1 + far)}M${n(x1)} ${n(y1 + near)}V${n(y1 + far)}`,
        ].join('');
        parts.push(`<path d="${d}" fill="none" stroke="#000" stroke-width="${n(CROP_MARK_STROKE_MM * ppm)}"/>`);

        const fontPx = SLUG_FONT_MM * ppm;
        const vars = {
            trim: formatShopTrim(layout.trimWMm, layout.trimHMm, p.size.unit),
            squaresX,
            squaresY,
            mm: squareMm,
            version,
        };
        const slug = slugLine(
            pdfLabels.shopSlugParts.map((t) => interpolate(t, vars)),
            fontPx,
            (layout.trimWMm - 2 * SLUG_SIDE_INSET_MM) * ppm,
        );
        parts.push(
            outlineText(slug, {
                x: x0 + SLUG_SIDE_INSET_MM * ppm,
                y: y1 + (bleedMm + SLUG_BASELINE_BELOW_BLEED_MM) * ppm,
                fontPx,
            }),
        );
    }

    return {
        svg: svgRootOpen(mediaW * ppm, mediaH * ppm, widthAttr, heightAttr) + parts.join('') + SVG_ROOT_CLOSE,
        mediaMm: {w: mediaW, h: mediaH},
        trimBoxMm: {x: marginMm, y: marginMm, w: layout.trimWMm, h: layout.trimHMm},
        bleedBoxMm: {x: marginMm - bleedMm, y: marginMm - bleedMm, w: layout.trimWMm + 2 * bleedMm, h: layout.trimHMm + 2 * bleedMm},
    };
}

/**
 * Renders the print-shop sheet with its QR (the shop link) and logo. Refuses without the logo: a shop
 * board is printed once, at cost, so it must not go out incomplete.
 */
export async function renderShopPrintSvg(params: {
    squaresX: number;
    squaresY: number;
    squareMm: number;
    layout: ShopLayout;
    size: ShopSizeChoice;
    options: ShopPrintOptions;
    documentationSourceUrl?: string;
}): Promise<ShopSheetSvg & {chartUrl: string}> {
    const ppm = PIXELS_PER_MM;
    const chartUrl = buildCharucoDocumentationUrl(
        params.documentationSourceUrl ?? getCharucoPrintSourceUrl(),
        params.squaresX,
        params.squaresY,
        params.squareMm,
        {kind: 'shop', size: params.size, options: params.options},
    );
    const qrSvgFragment = await generateQrSvgFragment(chartUrl, Math.round(QR_SIZE_MM * ppm));
    const logo = await resolveLogoForPrint(ppm);
    if (!logo.logoSvgInner) {
        throw new Error('The FreeMoCap logo did not load, so the print-shop file was not made. Reload the page and try again.');
    }
    return {
        ...renderShopSheetSvg({
            ...params,
            qrSvgFragment,
            logoSvgInner: logo.logoSvgInner,
            logoWidthPx: logo.widthPx,
            logoHeightPx: logo.heightPx,
        }),
        chartUrl,
    };
}
