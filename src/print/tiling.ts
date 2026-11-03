/**
 * Sheet tiling for ChArUco print PDFs. Adapted from `_compute_tiling` in freemocap's
 * `charuco_board_print.py` (iterate the sheet grid until it settles), but each sheet's board region
 * comes from per-edge safe margins and seam bands (`sheetGeometry.ts`), not freemocap's uniform 13 mm
 * margin and 12 mm join strip, so the two no longer tile the same.
 */
import {originBannerReserveMm} from './originBannerLayout.js';
import {boardRegionMm, originMarkerRoomMm} from './sheetGeometry.js';

export interface TilingInfo {
    pageCount: number;
    maxCx: number;
    maxCyFirst: number;
    maxCyRest: number;
    npx: number;
    npy: number;
    /** The chart sheet (mm) this tiling was computed for, turned the way it prints. */
    paperWMm: number;
    paperHMm: number;
    /** Banner strip (mm) above the board on a single-sheet chart; 0 otherwise. */
    bannerReserveMm: number;
}

export interface PageSpec {
    gx0: number;
    gx1: number;
    gy0: number;
    gy1: number;
    sheetIndex: number;
    isOriginPage: boolean;
    col: number;
    row: number;
}

/** Column indices whose board region differs: the first, a middle one and the last. */
function distinctSheetIndices(count: number): number[] {
    return count <= 1 ? [0] : count === 2 ? [0, 1] : [0, 1, count - 1];
}

/**
 * Tiles the board with `bannerStripMm` reserved above it on the first sheet. Every sheet column holds
 * the same number of squares, and every row after the first too: the fewest the tightest sheet of that
 * kind fits, given its board region (`sheetGeometry.ts`) and, on the first sheet, the corner marker.
 */
function tileWithFirstSheetReserve(
    squaresX: number,
    squaresY: number,
    squareMm: number,
    paperWMm: number,
    paperHMm: number,
    bannerStripMm: number,
): TilingInfo | null {
    const marker = originMarkerRoomMm(bannerStripMm);
    let npx = 1;
    let npy = 1;
    for (let i = 0; i < 24; i++) {
        const layout = {npx, npy, bannerReserveMm: bannerStripMm};
        const widthMm = (col: number): number => {
            const r = boardRegionMm(paperWMm, paperHMm, layout, col, 0);
            return paperWMm - r.left - r.right - (col === 0 ? marker.left : 0);
        };
        const heightMm = (row: number): number => {
            const r = boardRegionMm(paperWMm, paperHMm, layout, 0, row);
            return paperHMm - r.top - r.bottom - (row === 0 ? marker.top : 0);
        };
        const maxCx = Math.floor(Math.min(...distinctSheetIndices(npx).map(widthMm)) / squareMm);
        const maxCyFirst = Math.floor(heightMm(0) / squareMm);
        // With one row there are no later rows; size them as a last row, for the orientation tie-break.
        const restRows = npy <= 2 ? [1] : [1, npy - 1];
        const maxCyRest = Math.floor(Math.min(...restRows.map(heightMm)) / squareMm);
        if (maxCx < 1 || maxCyFirst < 1 || maxCyRest < 1) {
            return null;
        }

        const nextNpx = Math.ceil(squaresX / maxCx);
        const nextNpy = squaresY <= maxCyFirst ? 1 : 1 + Math.ceil((squaresY - maxCyFirst) / maxCyRest);
        // More sheets only ever shrink the regions, so the counts only grow until they settle.
        if (nextNpx === npx && nextNpy === npy) {
            return {pageCount: npx * npy, maxCx, maxCyFirst, maxCyRest, npx, npy, paperWMm, paperHMm, bannerReserveMm: bannerStripMm};
        }
        npx = nextNpx;
        npy = nextNpy;
    }
    return null;
}

/**
 * A chart that fits on one sheet carries the origin banner above the board. A chart that needs several
 * prints the banner on the assembly guide instead, so its first sheet reserves nothing. If the board fits
 * on one sheet only without the banner, it keeps the sheets tiled with the banner's strip reserved, since
 * a single sheet must carry the banner, but prints them without the strip: a first sheet without it is
 * never shorter (`check:presets`), so the tiles still fit.
 */
function tileOneOrientation(
    squaresX: number,
    squaresY: number,
    squareMm: number,
    paperWMm: number,
    paperHMm: number,
): TilingInfo | null {
    const withBanner = tileWithFirstSheetReserve(
        squaresX,
        squaresY,
        squareMm,
        paperWMm,
        paperHMm,
        originBannerReserveMm(paperWMm, paperHMm),
    );
    if (withBanner?.pageCount === 1) {
        return withBanner;
    }
    const withoutBanner = tileWithFirstSheetReserve(squaresX, squaresY, squareMm, paperWMm, paperHMm, 0);
    if (withoutBanner && withoutBanner.pageCount > 1) {
        return withoutBanner;
    }
    return withBanner && {...withBanner, bannerReserveMm: 0};
}

/**
 * The layout printed for this board and square length, or `null` if it cannot be printed at all. The
 * board is always exactly `squaresX`×`squaresY` (never transposed); only the paper turns: fewest
 * sheets, then the most squares per sheet (`maxCx * maxCyRest`), then the board's own aspect (wider
 * boards take landscape, taller and square ones portrait).
 */
export function printedLayout(
    squaresX: number,
    squaresY: number,
    squareMm: number,
    nominalWMm: number,
    nominalHMm: number,
): TilingInfo | null {
    const portrait = tileOneOrientation(squaresX, squaresY, squareMm, nominalWMm, nominalHMm);
    const landscape = tileOneOrientation(squaresX, squaresY, squareMm, nominalHMm, nominalWMm);
    if (!portrait || !landscape) {
        return portrait ?? landscape;
    }
    const better =
        portrait.pageCount - landscape.pageCount ||
        landscape.maxCx * landscape.maxCyRest - portrait.maxCx * portrait.maxCyRest;
    if (better !== 0) {
        return better < 0 ? portrait : landscape;
    }
    return squaresX > squaresY ? landscape : portrait;
}

/**
 * Sheets of paper printed for a chart tiled onto `chartSheets` sheets: a chart that spans several also
 * gets an assembly guide sheet in front of them. UI sheet counts show this; layout math uses `chartSheets`.
 */
export function printedSheetCount(chartSheets: number): number {
    return chartSheets > 1 ? chartSheets + 1 : chartSheets;
}

export function buildPageSpecs(squaresX: number, squaresY: number, tiling: TilingInfo): PageSpec[] {
    const {maxCx, maxCyFirst, maxCyRest, npx} = tiling;
    const rowRanges: [number, number][] = [];
    let gy = 0;
    while (gy < squaresY) {
        const cap = gy === 0 ? maxCyFirst : maxCyRest;
        const gyEnd = Math.min(gy + cap, squaresY);
        rowRanges.push([gy, gyEnd]);
        gy = gyEnd;
    }
    const pages: PageSpec[] = [];
    let sheet = 0;
    for (let row = 0; row < rowRanges.length; row++) {
        const [gy0, gy1] = rowRanges[row]!;
        for (let col = 0; col < npx; col++) {
            sheet += 1;
            const gx0 = col * maxCx;
            const gx1 = Math.min(gx0 + maxCx, squaresX);
            pages.push({
                gx0,
                gx1,
                gy0,
                gy1,
                sheetIndex: sheet,
                isOriginPage: col === 0 && row === 0,
                col,
                row,
            });
        }
    }
    return pages;
}
