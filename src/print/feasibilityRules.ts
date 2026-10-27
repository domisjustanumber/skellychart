/**
 * Single source of truth for what a board prints as. The printed board is always exactly
 * `squaresX`×`squaresY` (never transposed); only the paper orientation is chosen, by
 * {@link computeTilingInfo} (fewest sheets, then largest tiles).
 *
 * There is no fixed page cap: the most sheets a grid can use is one square per sheet at the largest
 * square length that still prints. Scans are cheap (pure arithmetic, ~0.05 ms per grid) and cached
 * per paper and grid, so the UI computes them live instead of shipping precomputed tables.
 */
import {CHARUCO_SQUARE_MM_MAX, CHARUCO_SQUARE_MM_MIN} from './constants.js';
import {computeTilingInfo, type TilingInfo} from './tiling.js';

/** The layout printed for this board and square length, or `null` if it cannot be printed at all. */
export function printedLayout(
    squaresX: number,
    squaresY: number,
    squareMm: number,
    paperWMm: number,
    paperHMm: number,
): TilingInfo | null {
    return computeTilingInfo(squaresX, squaresY, squareMm, paperWMm, paperHMm);
}

export interface GridFeasibility {
    /** Square lengths (mm) that print, ascending. */
    validSquaresMm: number[];
    /** Page counts some square length prints on, ascending. */
    pageCounts: number[];
    /** For each entry of {@link pageCounts}: the largest square length that prints on exactly that many sheets. */
    maxSquareMmByPageCount: Map<number, number>;
}

const cache = new Map<string, GridFeasibility>();
const CACHE_LIMIT = 512;

/** Every whole-mm square length scanned once for this grid and paper (memoised). */
export function gridFeasibility(squaresX: number, squaresY: number, paperWMm: number, paperHMm: number): GridFeasibility {
    const key = `${paperWMm}x${paperHMm}:${squaresX}x${squaresY}`;
    const hit = cache.get(key);
    if (hit) {
        return hit;
    }
    const validSquaresMm: number[] = [];
    const maxSquareMmByPageCount = new Map<number, number>();
    for (let s = CHARUCO_SQUARE_MM_MIN; s <= CHARUCO_SQUARE_MM_MAX; s++) {
        const t = printedLayout(squaresX, squaresY, s, paperWMm, paperHMm);
        if (t) {
            validSquaresMm.push(s);
            maxSquareMmByPageCount.set(t.pageCount, s);
        }
    }
    const result: GridFeasibility = {
        validSquaresMm,
        pageCounts: [...maxSquareMmByPageCount.keys()].sort((a, b) => a - b),
        maxSquareMmByPageCount,
    };
    if (cache.size >= CACHE_LIMIT) {
        cache.clear();
    }
    cache.set(key, result);
    return result;
}
