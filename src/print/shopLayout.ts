/**
 * Print-shop board geometry: one sheet trimmed to a standard size, the board at exactly 1:1 under a
 * compact banner, a white quiet zone on every side, centred in the trim. Pure: no DOM. The page (trim plus
 * bleed and any crop-mark margin) is added from the print options at render time; feasibility depends on
 * the trim only, so bleed and marks never change what fits.
 */
import {APP_VERSION_DISPLAY} from '../appVersion.js';
import type {ShopSizeId, ShopUnit} from './charucoDocUrl.js';
import {
    boardGridAxisMax,
    BOARD_GRID_MAX,
    BOARD_GRID_MIN,
    SQUARE_LENGTH_LT_2M_MAX_MM,
    SQUARE_LENGTH_LT_4M_MAX_MM,
    workingDistanceMinSquareMm,
    type WorkingDistanceTierId,
} from './charucoLayout.js';
import {
    CHARUCO_SQUARE_MM_MIN,
    ORIGIN_BANNER_VISUAL_SCALE,
    ORIGIN_CORNER_MARKER_SIDE_ROOM_MM,
    ORIGIN_CORNER_MARKER_TOP_ROOM_MM,
    PIXELS_PER_MM,
    SKELLY_TOP_HEIGHT_MM,
} from './constants.js';
import {helveticaTextWidthPx} from './helveticaMetrics.js';
import {bannerLogoSizePx, compactBannerHeightMm, compactBannerMinWidthPx} from './originBannerLayout.js';
import {SHOP_SQUARE_MM_MAX, shopSizeById, shopSizeGroups} from './shopSizes.js';
import {SKELLY_LOGO_NATURAL_W_OVER_H} from './skellyLogo.js';
import {paperOrientationPreferenceTieBreak} from './tiling.js';

/** White quiet zone inside the trim on every side (mm): a quarter square, at least 10 mm, at most 25 mm. */
export function shopQuietZoneMm(squareMm: number): number {
    return Math.min(25, Math.max(10, squareMm / 4));
}

const bannerCache = new Map<string, {heightMm: number; minWidthMm: number}>();

/** Compact banner size (mm) for this chart: its height, and the narrowest width it fits without wrapping. */
export function shopBannerSizeMm(
    squaresX: number,
    squaresY: number,
    squareMm: number,
    version: string = APP_VERSION_DISPLAY,
): {heightMm: number; minWidthMm: number} {
    // The banner depends on the numbers only through their printed widths, so few keys ever occur.
    const key = [version, squaresX, squaresY, squareMm].map((v) => helveticaTextWidthPx(String(v), 1000)).join('|') + version;
    const hit = bannerCache.get(key);
    if (hit) {
        return hit;
    }
    const logo = bannerLogoSizePx(SKELLY_TOP_HEIGHT_MM, SKELLY_LOGO_NATURAL_W_OVER_H);
    const params = {
        typeScale: ORIGIN_BANNER_VISUAL_SCALE,
        version,
        squareLengthMm: squareMm,
        squaresX,
        squaresY,
        logoWidthPx: logo.widthPx,
        logoHeightPx: logo.heightPx,
    };
    const size = {
        heightMm: compactBannerHeightMm(params),
        minWidthMm: compactBannerMinWidthPx(params) / PIXELS_PER_MM,
    };
    bannerCache.set(key, size);
    return size;
}

/** A box in mm from the trim's top-left corner. */
export interface ShopBoxMm {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface ShopLayout {
    sizeId: ShopSizeId;
    /** The trim is the size turned long side across. */
    landscape: boolean;
    trimWMm: number;
    trimHMm: number;
    quietZoneMm: number;
    /** Banner above the board, as wide as the content block. */
    banner: ShopBoxMm;
    /** The board, centred under the banner. */
    board: ShopBoxMm;
    /** Banner plus board, centred in the trim with at least the quiet zone on every side. */
    content: ShopBoxMm;
}

/** Layout on one orientation of a trim, or `null` if the chart plus quiet zone does not fit. */
function layoutOnTrim(
    squaresX: number,
    squaresY: number,
    squareMm: number,
    trimWMm: number,
    trimHMm: number,
    banner: {heightMm: number; minWidthMm: number},
): Omit<ShopLayout, 'sizeId' | 'landscape'> | null {
    const e = shopQuietZoneMm(squareMm);
    const boardW = squaresX * squareMm;
    const boardH = squaresY * squareMm;
    const contentW = Math.max(boardW, banner.minWidthMm);
    const contentH = banner.heightMm + boardH;
    if (contentW + 2 * e > trimWMm + 1e-9 || contentH + 2 * e > trimHMm + 1e-9) {
        return null;
    }
    const content = {x: (trimWMm - contentW) / 2, y: (trimHMm - contentH) / 2, w: contentW, h: contentH};
    return {
        trimWMm,
        trimHMm,
        quietZoneMm: e,
        banner: {x: content.x, y: content.y, w: contentW, h: banner.heightMm},
        board: {x: content.x + (contentW - boardW) / 2, y: content.y + banner.heightMm, w: boardW, h: boardH},
        content,
    };
}

/**
 * The board on a standard size, or `null` if it does not fit either way round. When both orientations fit,
 * the one that would hold more squares wins, then the board's own aspect (as home paper picks orientation).
 */
export function shopSheetLayout(
    squaresX: number,
    squaresY: number,
    squareMm: number,
    sizeId: ShopSizeId,
    version: string = APP_VERSION_DISPLAY,
): ShopLayout | null {
    const size = shopSizeById(sizeId);
    const banner = shopBannerSizeMm(squaresX, squaresY, squareMm, version);
    const candidates = [false, true].flatMap((landscape) => {
        const [w, h] = landscape ? [size.hMm, size.wMm] : [size.wMm, size.hMm];
        const layout = layoutOnTrim(squaresX, squaresY, squareMm, w, h, banner);
        if (!layout) {
            return [];
        }
        const e = layout.quietZoneMm;
        const capacity = Math.floor((w - 2 * e) / squareMm) * Math.floor((h - 2 * e - banner.heightMm) / squareMm);
        return [{layout: {...layout, sizeId, landscape}, capacity, preference: paperOrientationPreferenceTieBreak(squaresX, squaresY, landscape)}];
    });
    candidates.sort((a, b) => b.capacity - a.capacity || a.preference - b.preference);
    return candidates[0]?.layout ?? null;
}

const squareCache = new Map<string, number[]>();
const SQUARE_CACHE_LIMIT = 512;

/** Square lengths (mm) the board prints at on this size, ascending; contiguous from 10 mm when any fit. */
export function shopValidSquaresMm(
    squaresX: number,
    squaresY: number,
    sizeId: ShopSizeId,
    version: string = APP_VERSION_DISPLAY,
): number[] {
    const key = `${sizeId}:${squaresX}x${squaresY}:${version}`;
    const hit = squareCache.get(key);
    if (hit) {
        return hit;
    }
    const valid: number[] = [];
    for (let s = CHARUCO_SQUARE_MM_MIN; s <= SHOP_SQUARE_MM_MAX; s++) {
        if (shopSheetLayout(squaresX, squaresY, s, sizeId, version)) {
            valid.push(s);
        }
    }
    if (squareCache.size >= SQUARE_CACHE_LIMIT) {
        squareCache.clear();
    }
    squareCache.set(key, valid);
    return valid;
}

/** Largest square length (mm) the board prints at on this size, or `null` if none. */
export function maxShopSquareMm(
    squaresX: number,
    squaresY: number,
    sizeId: ShopSizeId,
    version: string = APP_VERSION_DISPLAY,
): number | null {
    const valid = shopValidSquaresMm(squaresX, squaresY, sizeId, version);
    return valid[valid.length - 1] ?? null;
}

/** Nearest square length at or above `minSquareMm` the board prints at on this size (ties go smaller). */
export function snapShopSquareMm(
    raw: number,
    squaresX: number,
    squaresY: number,
    sizeId: ShopSizeId,
    minSquareMm: number = CHARUCO_SQUARE_MM_MIN,
    version: string = APP_VERSION_DISPLAY,
): number | null {
    const target = Math.round(Math.max(CHARUCO_SQUARE_MM_MIN, Math.min(SHOP_SQUARE_MM_MAX, raw)));
    let best: number | null = null;
    for (const s of shopValidSquaresMm(squaresX, squaresY, sizeId, version)) {
        if (s >= minSquareMm && (best === null || Math.abs(s - target) < Math.abs(best - target))) {
            best = s;
        }
    }
    return best;
}

/**
 * End-stop for X or Y in shop mode: the largest count on `axis` that prints at this square length on this
 * size and keeps the board within the marker dictionary, given the other axis. `null` if even 2 does not fit.
 */
export function maxShopGridForSquare(
    axis: 'squaresX' | 'squaresY',
    otherAxisCount: number,
    squareMm: number,
    sizeId: ShopSizeId,
    version: string = APP_VERSION_DISPLAY,
): number | null {
    for (let n = Math.min(BOARD_GRID_MAX, boardGridAxisMax(otherAxisCount)); n >= BOARD_GRID_MIN; n--) {
        const [x, y] = axis === 'squaresX' ? [n, otherAxisCount] : [otherAxisCount, n];
        if (shopSheetLayout(x, y, squareMm, sizeId, version)) {
            return n;
        }
    }
    return null;
}

/**
 * Default size for a board: the smallest standard size it fits on, searching the toggled unit's sizes
 * first (by area), then the other unit's; `null` if it fits none.
 */
export function smallestFittingShopSize(
    squaresX: number,
    squaresY: number,
    squareMm: number,
    unit: ShopUnit,
    version: string = APP_VERSION_DISPLAY,
): ShopSizeId | null {
    for (const group of shopSizeGroups(unit)) {
        for (const size of group.sizes) {
            if (shopSheetLayout(squaresX, squaresY, squareMm, size.id, version)) {
                return size.id;
            }
        }
    }
    return null;
}

/** Room the origin corner marker needs beside and above the board (mm); the quiet zone and banner gap cover it. */
export const SHOP_MARKER_ROOM_MM = {left: ORIGIN_CORNER_MARKER_SIDE_ROOM_MM, top: ORIGIN_CORNER_MARKER_TOP_ROOM_MM};

/**
 * Print-shop preset for a working distance: close 7 × 5 and near 5 × 3 at the top of their bands, far 3 × 5
 * at the largest square on the smallest size that takes it at the band minimum; each on its default size.
 */
export function resolveShopDistancePlan(
    tier: WorkingDistanceTierId,
    unit: ShopUnit,
    version: string = APP_VERSION_DISPLAY,
): {squaresX: number; squaresY: number; squareMm: number; sizeId: ShopSizeId} | null {
    const [squaresX, squaresY] = tier === 'far' ? [3, 5] : tier === 'close' ? [7, 5] : [5, 3];
    if (tier !== 'far') {
        const squareMm = tier === 'close' ? SQUARE_LENGTH_LT_2M_MAX_MM : SQUARE_LENGTH_LT_4M_MAX_MM;
        const sizeId = smallestFittingShopSize(squaresX, squaresY, squareMm, unit, version);
        return sizeId ? {squaresX, squaresY, squareMm, sizeId} : null;
    }
    const sizeId = smallestFittingShopSize(squaresX, squaresY, workingDistanceMinSquareMm('far'), unit, version);
    const squareMm = sizeId ? maxShopSquareMm(squaresX, squaresY, sizeId, version) : null;
    return sizeId && squareMm ? {squaresX, squaresY, squareMm, sizeId} : null;
}
