/**
 * Sheet tiling for ChArUco print PDFs. Adapted from `_compute_tiling` in freemocap's
 * `charuco_board_print.py` (iterate the sheet grid until it settles), but each sheet's board region
 * comes from per-edge safe margins and seam bands (`sheetGeometry.ts`), not freemocap's uniform 13 mm
 * margin and 12 mm join strip, so the two no longer tile the same.
 */
import {originBannerReserveMm} from './originBannerStrip.js';
import {boardRegionMm, originMarkerRoomMm} from './sheetGeometry.js';

export interface TilingInfo {
    pageCount: number;
    maxCx: number;
    maxCyFirst: number;
    maxCyRest: number;
    npx: number;
    npy: number;
    landscape: boolean;
    /**
     * Strip (mm) reserved above the board on the first sheet for the origin banner. Only a single-sheet
     * chart carries the banner; a multi-sheet chart prints it on the assembly guide, so this is 0 unless
     * the board fits on one sheet only without the banner (see {@link computeTilingInfoSingle}).
     */
    bannerReserveMm: number;
}

export interface PageSpec {
    gx0: number;
    gx1: number;
    gy0: number;
    gy1: number;
    sheetIndex: number;
    isOriginPage: boolean;
    npx: number;
    npy: number;
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
): Omit<TilingInfo, 'landscape'> | null {
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
            return {pageCount: npx * npy, maxCx, maxCyFirst, maxCyRest, npx, npy, bannerReserveMm: bannerStripMm};
        }
        npx = nextNpx;
        npy = nextNpy;
    }
    return null;
}

/**
 * A chart that fits on one sheet carries the origin banner above the board. A chart that needs several
 * prints the banner on the assembly guide instead, so its first sheet reserves nothing. If the board fits
 * on one sheet only without the banner, it keeps the layout tiled with the banner's strip reserved (left
 * empty), since a single sheet must carry the banner.
 */
function computeTilingInfoSingle(
    squaresX: number,
    squaresY: number,
    squareMm: number,
    paperWMm: number,
    paperHMm: number,
): Omit<TilingInfo, 'landscape'> | null {
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
    return withoutBanner && withoutBanner.pageCount > 1 ? withoutBanner : withBanner;
}

/**
 * When page count and per-sheet tile-area score (`maxCx * maxCyRest`) tie, prefer sheet orientation
 * that matches grid aspect: wider boards (sx > sy) favor landscape paper; taller boards favor portrait.
 * Square boards keep portrait (matches historical default).
 */
export function paperOrientationPreferenceTieBreak(squaresX: number, squaresY: number, landscape: boolean): number {
    if (squaresX === squaresY) {
        return landscape ? 1 : 0;
    }
    if (squaresX > squaresY) {
        return landscape ? 0 : 1;
    }
    return landscape ? 1 : 0;
}

export function computeTilingInfo(
    squaresX: number,
    squaresY: number,
    squareMm: number,
    nominalWMm: number,
    nominalHMm: number,
): TilingInfo | null {
    if (Math.abs(nominalWMm - nominalHMm) < 0.01) {
        const t = computeTilingInfoSingle(squaresX, squaresY, squareMm, nominalWMm, nominalHMm);
        return t ? {...t, landscape: false} : null;
    }
    const portrait = computeTilingInfoSingle(squaresX, squaresY, squareMm, nominalWMm, nominalHMm);
    const landscape = computeTilingInfoSingle(squaresX, squaresY, squareMm, nominalHMm, nominalWMm);
    const scored: {
        info: Omit<TilingInfo, 'landscape'>;
        landscape: boolean;
        key: [number, number, number];
    }[] = [];
    if (portrait) {
        const prod = portrait.maxCx * portrait.maxCyRest;
        scored.push({
            info: portrait,
            landscape: false,
            key: [portrait.pageCount, -prod, paperOrientationPreferenceTieBreak(squaresX, squaresY, false)],
        });
    }
    if (landscape) {
        const prod = landscape.maxCx * landscape.maxCyRest;
        scored.push({
            info: landscape,
            landscape: true,
            key: [landscape.pageCount, -prod, paperOrientationPreferenceTieBreak(squaresX, squaresY, true)],
        });
    }
    if (scored.length === 0) {
        return null;
    }
    scored.sort((a, b) => {
        for (let i = 0; i < 3; i++) {
            if (a.key[i] !== b.key[i]) {
                return a.key[i]! - b.key[i]!;
            }
        }
        return 0;
    });
    const best = scored[0]!;
    return {...best.info, landscape: best.landscape};
}

/**
 * PDF / physical sheet width×height (mm) for a nominal paper size from presets (`wMm`×`hMm`, short×long).
 * Must match the orientation used when `tiling` was computed (`computeTilingInfo*` swaps dimensions
 * when `landscape` is true); otherwise `maxCx` / row caps assume the wrong printable width and tiles
 * bisect ChArUco squares on the raster.
 */
export function nominalPaperToPdfDimensionsMm(
    nominalWMm: number,
    nominalHMm: number,
    tiling: TilingInfo,
): {paperWMm: number; paperHMm: number} {
    if (Math.abs(nominalWMm - nominalHMm) < 0.01) {
        return {paperWMm: nominalWMm, paperHMm: nominalHMm};
    }
    if (tiling.landscape) {
        return {paperWMm: nominalHMm, paperHMm: nominalWMm};
    }
    return {paperWMm: nominalWMm, paperHMm: nominalHMm};
}

/**
 * Sheets of paper printed for a chart tiled onto `chartSheets` sheets: a chart that spans several also
 * gets an assembly guide sheet in front of them. UI sheet counts show this; layout math uses `chartSheets`.
 */
export function printedSheetCount(chartSheets: number): number {
    return chartSheets > 1 ? chartSheets + 1 : chartSheets;
}

export function buildPageSpecs(
    squaresX: number,
    squaresY: number,
    tiling: TilingInfo,
): {pages: PageSpec[]; npx: number; npy: number} {
    const {maxCx, maxCyFirst, maxCyRest, npx} = tiling;
    const rowRanges: [number, number][] = [];
    let gy = 0;
    while (gy < squaresY) {
        const cap = gy === 0 ? maxCyFirst : maxCyRest;
        const gyEnd = Math.min(gy + cap, squaresY);
        rowRanges.push([gy, gyEnd]);
        gy = gyEnd;
    }
    const npy = rowRanges.length;
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
                npx,
                npy,
                col,
                row,
            });
        }
    }
    return {pages, npx, npy};
}
