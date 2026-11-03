/**
 * Build guard for the origin banner, which is laid out live (`src/print/originBannerLayout.ts`), for every
 * version that gets built (dev and release), square length and grid:
 *
 * - Home sheets: every paper in portrait and landscape lays the banner's instruction and chart-info
 *   columns out side by side, on a single-sheet chart and on the assembly guide, and a single-sheet
 *   chart's banner is one height whatever the chart: exactly the strip tiling reserves
 *   (`originBannerReserveMm`), with no spare line.
 * - The header line of chart sheets sits in the top margin: its caps inside the safe margin, its
 *   descenders above the board.
 * - Print-shop boards: the compact banner is one height for every chart (the QR sets it), and narrow.
 */
import {PACKAGE_VERSION} from './useBuildAppVersion.js';
import {DEV_APP_VERSION, displayAppVersion} from '../src/appVersion.js';
import {BOARD_GRID_MAX, BOARD_GRID_MIN, PAPER_OPTIONS, boardGridAxisMax} from '../src/print/charucoLayout.js';
import {
    CHARUCO_SQUARE_MM_MAX,
    CHARUCO_SQUARE_MM_MIN,
    MM_HEADER_CONTENT_TOP_MM,
    MM_SHEET_HEADER_BASELINE_MM,
    PIXELS_PER_MM,
    SHEET_HEADER_FONT_PX,
} from '../src/print/constants.js';
import {GLYPH_CAP_HEIGHT_EM} from '../src/print/glyphOutlines.generated.js';
import {helveticaTextWidthPx} from '../src/print/helveticaMetrics.js';
import {
    compactBannerHeightMm,
    compactBannerMinWidthPx,
    layoutOriginBanner,
    originBannerReserveMm,
    originBannerStripPx,
} from '../src/print/originBannerLayout.js';
import {sheetSafeMarginsMm} from '../src/print/sheetGeometry.js';
import {SHOP_SQUARE_MM_MAX} from '../src/print/shopSizes.js';

/** Helvetica cap height and descender (em), for the header's ink. */
const CAP_HEIGHT_EM = 0.718;
const DESCENDER_EM = 0.207;

const failures: string[] = [];
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const BUILT = displayAppVersion(PACKAGE_VERSION);
/** Dev servers print `DEV_APP_VERSION`; builds print the package version. */
const VERSIONS = [DEV_APP_VERSION, PACKAGE_VERSION].map(displayAppVersion);

/** One value per distinct printed width: the banner depends on numbers only through their Helvetica widths. */
function widthRepresentatives(min: number, max: number): number[] {
    const byWidth = new Map<number, number>();
    for (let v = max; v >= min; v--) {
        byWidth.set(helveticaTextWidthPx(String(v), 1000), v);
    }
    return [...byWidth.values()];
}
const gridCounts = widthRepresentatives(BOARD_GRID_MIN, BOARD_GRID_MAX);

// Home sheets.
const squareMms = widthRepresentatives(CHARUCO_SQUARE_MM_MIN, CHARUCO_SQUARE_MM_MAX);
const headerFontMm = SHEET_HEADER_FONT_PX / PIXELS_PER_MM;
const headerBaselineMm = Math.round(MM_SHEET_HEADER_BASELINE_MM * PIXELS_PER_MM) / PIXELS_PER_MM;
for (const paper of PAPER_OPTIONS) {
    for (const [widthMm, heightMm, orientation] of [
        [paper.wMm, paper.hMm, 'portrait'],
        [paper.hMm, paper.wMm, 'landscape'],
    ] as const) {
        const sheet = `${paper.id} ${orientation}`;
        const m = sheetSafeMarginsMm(widthMm, heightMm);
        if (headerBaselineMm - CAP_HEIGHT_EM * headerFontMm < m.top) {
            failures.push(`${sheet}: the header's caps reach above the ${m.top} mm safe top margin`);
        }
        if (headerBaselineMm + DESCENDER_EM * headerFontMm >= MM_HEADER_CONTENT_TOP_MM) {
            failures.push(`${sheet}: the header's descenders reach the board at ${MM_HEADER_CONTENT_TOP_MM} mm`);
        }
        const reservePx = Math.round(originBannerReserveMm(widthMm, heightMm) * PIXELS_PER_MM);
        for (const version of VERSIONS) {
            const heights = new Map<number, string[]>();
            for (const squareLengthMm of squareMms) {
                for (const squaresX of gridCounts) {
                    for (const squaresY of gridCounts) {
                        const inputs = `v${version}, ${squareLengthMm} mm, ${squaresX}×${squaresY}`;
                        for (const instructions of ['chart', 'guide'] as const) {
                            try {
                                const layout = layoutOriginBanner({
                                    instructions,
                                    paperWMm: widthMm,
                                    paperHMm: heightMm,
                                    version,
                                    squareLengthMm,
                                    squaresX,
                                    squaresY,
                                    hasLogo: true,
                                });
                                if (instructions === 'chart') {
                                    const px = originBannerStripPx(layout);
                                    heights.set(px, [...(heights.get(px) ?? []), inputs]);
                                }
                            } catch (e) {
                                failures.push(`${sheet}, ${instructions}: ${(e as Error).message}`);
                            }
                        }
                    }
                }
            }
            if (heights.size > 1) {
                const detail = [...heights].map(([px, inputs]) => `${px / PIXELS_PER_MM} mm for ${inputs.slice(0, 3).join('; ')}`);
                failures.push(`${sheet}: banner height varies with the chart, so no single height is exact: ${detail.join(' | ')}`);
                continue;
            }
            const [px] = [...heights.keys()];
            if (px === undefined) {
                continue;
            }
            if (version === BUILT && px !== reservePx) {
                failures.push(`${sheet}: tiling reserves ${reservePx / PIXELS_PER_MM} mm for a ${px / PIXELS_PER_MM} mm banner`);
            }
            console.log(`${sheet.padEnd(18)} v${version.padEnd(10)} ${(px / PIXELS_PER_MM).toFixed(2)} mm banner`);
        }
    }
}

// Compact banner: one height for every square length, grid and version (the QR sets it), and narrow.
const bannerHeights = new Set<number>();
let widestBannerPx = 0;
let bannerLayouts = 0;
for (const version of VERSIONS) {
    for (const squareLengthMm of widthRepresentatives(CHARUCO_SQUARE_MM_MIN, SHOP_SQUARE_MM_MAX)) {
        for (const squaresX of gridCounts) {
            for (const squaresY of gridCounts.filter((y) => y <= boardGridAxisMax(squaresX))) {
                const params = {version, squareLengthMm, squaresX, squaresY, hasLogo: true, capHeightEm: GLYPH_CAP_HEIGHT_EM};
                bannerHeights.add(Math.round(compactBannerHeightMm(params) * 1e6) / 1e6);
                widestBannerPx = Math.max(widestBannerPx, compactBannerMinWidthPx(params));
                bannerLayouts++;
            }
        }
    }
}
if (bannerHeights.size !== 1 || ![...bannerHeights].every((h) => near(h, 28.5))) {
    failures.push(`compact banner heights are ${[...bannerHeights].join(', ')} mm, expected 28.5 mm for every chart`);
}
if (widestBannerPx / PIXELS_PER_MM > 110) {
    failures.push(`compact banner needs ${(widestBannerPx / PIXELS_PER_MM).toFixed(1)} mm, more than 110 mm`);
}
{
    // At its minimum width the banner lays out; one px narrower a chart-info line would wrap.
    const params = {version: VERSIONS[0]!, squareLengthMm: 260, squaresX: 20, squaresY: 25, hasLogo: true};
    const minPx = compactBannerMinWidthPx(params);
    const at = (w: number) => {
        try {
            return layoutOriginBanner({...params, paperWMm: 0, paperHMm: 0, variant: 'compact', box: {leftPx: 100, rightPx: 100 + w, topPx: 50}});
        } catch {
            return null;
        }
    };
    if (!at(minPx) || at(minPx - 1) || at(minPx)!.instLines.length !== 0) {
        failures.push(`compact banner minimum width ${minPx} px is not the narrowest box it fits`);
    }
}

if (failures.length > 0) {
    console.error(`\nBanner check failed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
}
console.log(
    `check:banner: home banners exact for v${VERSIONS.join(', v')}; ` +
        `compact banner ${[...bannerHeights][0]} mm high, at most ${(widestBannerPx / PIXELS_PER_MM).toFixed(1)} mm wide (${bannerLayouts} charts)`,
);
