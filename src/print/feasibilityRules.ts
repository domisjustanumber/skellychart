/**
 * Single source of truth for what a board prints as. The printed board is always exactly
 * `squaresX`×`squaresY` (never transposed); only the paper orientation is chosen, by
 * {@link printedLayout} (fewest sheets, then largest tiles).
 *
 * There is no fixed page cap: the most sheets a grid can use is one square per sheet at the largest
 * square length that still prints. Scans are cheap (pure arithmetic, ~0.05 ms per grid) and cached
 * per paper and grid, so the UI computes them live instead of shipping precomputed tables.
 */
import {CHARUCO_SQUARE_MM_MAX, CHARUCO_SQUARE_MM_MIN} from './constants.js';
import {printedLayout} from './tiling.js';

/** One stop of the sheets stepper: a page count and the largest square length that prints exactly it. */
export interface PageStep {
    readonly pages: number;
    readonly squareMm: number;
}

export interface GridFeasibility {
    /**
     * Largest square length (mm) that prints, or `null` if none does. Every length from
     * CHARUCO_SQUARE_MM_MIN up to it prints too, with no gaps (checked by scripts/check-presets.ts).
     */
    maxSquareMm: number | null;
    /** Every page count some square length prints on, ascending, each at its largest square length. */
    steps: readonly PageStep[];
    /** The largest square length that prints on exactly that many sheets, by page count. */
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
    let maxSquareMm: number | null = null;
    const maxSquareMmByPageCount = new Map<number, number>();
    for (let s = CHARUCO_SQUARE_MM_MIN; s <= CHARUCO_SQUARE_MM_MAX; s++) {
        const t = printedLayout(squaresX, squaresY, s, paperWMm, paperHMm);
        if (t) {
            maxSquareMm = s;
            maxSquareMmByPageCount.set(t.pageCount, s);
        }
    }
    const result: GridFeasibility = {
        maxSquareMm,
        steps: [...maxSquareMmByPageCount]
            .map(([pages, squareMm]) => ({pages, squareMm}))
            .sort((a, b) => a.pages - b.pages),
        maxSquareMmByPageCount,
    };
    if (cache.size >= CACHE_LIMIT) {
        cache.clear();
    }
    cache.set(key, result);
    return result;
}
