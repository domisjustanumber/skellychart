/**
 * Distance presets, the board grid limits, and the sheets stepper and square-length snapping rules, on
 * top of the tiling (`tiling.ts`) and the feasibility tables (`feasibilityRules.ts`). The papers are in
 * `papers.ts`.
 */
import {BOARD_GRID_MAX, BOARD_GRID_MIN, CHARUCO_SQUARE_MM_MAX, CHARUCO_SQUARE_MM_MIN} from './constants.js';
import {gridFeasibility, type PageStep} from './feasibilityRules.js';
import {paperById, type PaperId} from './papers.js';
import {isLargeSheet} from './sheetGeometry.js';

export {CHARUCO_SQUARE_MM_MAX, CHARUCO_SQUARE_MM_MIN} from './constants.js';
export {printedLayout} from './tiling.js';
export type {PageStep} from './feasibilityRules.js';

/**
 * Working distances, nearest first: the smallest square length each allows, its preset grid and the
 * preset's sheet count on small (A4 / Letter) and large (A3 / Tabloid) paper. A square length maps to the
 * farthest distance whose minimum it meets (UI: “1 - 2m” up to 32 mm, “2 - 4m” up to 100 mm, then “4m +”).
 * The near minimum keeps the largest valid square for a 7×5 tile on A4/Letter (28 mm) in the close band.
 */
export const WORKING_DISTANCES = [
    {id: 'close', minSquareMm: CHARUCO_SQUARE_MM_MIN, squaresX: 7, squaresY: 5, pages: {small: 1, large: 1}},
    {id: 'near', minSquareMm: 33, squaresX: 5, squaresY: 3, pages: {small: 1, large: 1}},
    {id: 'far', minSquareMm: 101, squaresX: 3, squaresY: 5, pages: {small: 9, large: 3}},
] as const;

export type WorkingDistance = (typeof WORKING_DISTANCES)[number];
export type WorkingDistanceTierId = WorkingDistance['id'];

/** Default working-distance preset (2–4 m); labelled “(recommended)” in the dropdown. */
export const DEFAULT_WORKING_DISTANCE: WorkingDistanceTierId = 'near';

export function isWorkingDistanceId(id: string): id is WorkingDistanceTierId {
    return WORKING_DISTANCES.some((d) => d.id === id);
}

export function workingDistance(id: WorkingDistanceTierId): WorkingDistance {
    return WORKING_DISTANCES.find((d) => d.id === id)!;
}

/**
 * Smallest square length (mm) allowed at a working distance. Distance bands are minimums, not ranges:
 * a large square is fine at any distance, but squares below the band are too small to detect from there.
 */
export function workingDistanceMinSquareMm(tier: WorkingDistanceTierId): number {
    return workingDistance(tier).minSquareMm;
}

/** Largest square length (mm) that still maps to `tier`: just below the next distance's minimum. */
export function workingDistanceBandTopMm(tier: 'close' | 'near'): number {
    const i = WORKING_DISTANCES.findIndex((d) => d.id === tier);
    return WORKING_DISTANCES[i + 1]!.minSquareMm - 1;
}

export function resolveDistancePrintPlan(
    distanceId: WorkingDistanceTierId,
    paperId: PaperId,
): {squaresX: number; squaresY: number; targetPages: number} {
    const d = workingDistance(distanceId);
    const paper = paperById(paperId);
    return {squaresX: d.squaresX, squaresY: d.squaresY, targetPages: d.pages[isLargeSheet(paper.wMm, paper.hMm) ? 'large' : 'small']};
}

export function workingDistanceTierFromSquareLengthMm(squareMm: number): WorkingDistanceTierId {
    const m = Math.round(Math.max(CHARUCO_SQUARE_MM_MIN, Math.min(CHARUCO_SQUARE_MM_MAX, squareMm)));
    for (let i = WORKING_DISTANCES.length - 1; i > 0; i--) {
        if (m >= WORKING_DISTANCES[i]!.minSquareMm) {
            return WORKING_DISTANCES[i]!.id;
        }
    }
    return WORKING_DISTANCES[0].id;
}

/** Band edges as fractions of the square slider, which runs to `maxMm` (print-shop mode goes further). */
export function squareLengthTierBandEdgeFractions(maxMm: number = CHARUCO_SQUARE_MM_MAX): {closeNear: number; nearFar: number} {
    const span = maxMm - CHARUCO_SQUARE_MM_MIN;
    return {
        closeNear: (workingDistanceBandTopMm('close') - CHARUCO_SQUARE_MM_MIN) / span,
        nearFar: (workingDistanceBandTopMm('near') - CHARUCO_SQUARE_MM_MIN) / span,
    };
}

export {BOARD_GRID_MAX, BOARD_GRID_MIN};

/** Markers the dictionary holds (DICT_4X4_250); a board needs one per white square. */
export const BOARD_MARKERS_MAX = 250;

/** Markers on an X×Y board: one in every white square, floor(X·Y/2). */
export function charucoMarkerCount(squaresX: number, squaresY: number): number {
    return Math.floor((squaresX * squaresY) / 2);
}

/** Largest count on one axis that keeps the board within the dictionary, given the other axis (X·Y ≤ 501). */
export function boardGridAxisMax(otherAxisCount: number): number {
    return Math.min(BOARD_GRID_MAX, Math.floor((2 * BOARD_MARKERS_MAX + 1) / otherAxisCount));
}

/**
 * Largest square length that prints on exactly `pages` sheets, or `null` if no square length does. Here
 * and below, `banner` is the home setting ({@link printedLayout}).
 */
export function maxSquareMmForGridAndPages(
    squaresX: number,
    squaresY: number,
    paperWMm: number,
    paperHMm: number,
    pages: number,
    banner: boolean = true,
): number | null {
    return gridFeasibility(squaresX, squaresY, paperWMm, paperHMm, banner).maxSquareMmByPageCount.get(pages) ?? null;
}

/**
 * Stops of the sheets stepper, ascending: every page count the grid prints on whose largest square length
 * is at least `minSquareMm` (the working distance minimum), minus near-duplicates (a count whose largest
 * square is less than max(1 mm, 3%) bigger than the previous kept stop). The fewest and the most sheets
 * are always kept; the most is one square per sheet at the largest square length that prints.
 */
export function steppablePageCounts(
    squaresX: number,
    squaresY: number,
    paperWMm: number,
    paperHMm: number,
    minSquareMm: number = CHARUCO_SQUARE_MM_MIN,
    banner: boolean = true,
): PageStep[] {
    const all = gridFeasibility(squaresX, squaresY, paperWMm, paperHMm, banner).steps.filter((s) => s.squareMm >= minSquareMm);
    const kept: PageStep[] = [];
    all.forEach((step, i) => {
        const prev = kept[kept.length - 1];
        const isLast = i === all.length - 1;
        if (!prev || isLast || step.squareMm - prev.squareMm >= Math.max(1, Math.ceil(0.03 * prev.squareMm))) {
            kept.push(step);
        }
    });
    return kept;
}

/**
 * The stepper stops either side of the printed page count (which may itself be a skipped near-duplicate,
 * e.g. after moving the square slider), plus the fewest and most.
 */
export function pageStepNeighbours(
    steps: readonly PageStep[],
    currentPages: number,
): {fewer: PageStep | null; more: PageStep | null; fewest: PageStep | null; most: PageStep | null} {
    return {
        fewer: [...steps].reverse().find((s) => s.pages < currentPages) ?? null,
        more: steps.find((s) => s.pages > currentPages) ?? null,
        fewest: steps[0] ?? null,
        most: steps[steps.length - 1] ?? null,
    };
}

/**
 * Nearest printable square length, or `null` if none exists. A grid prints every length from
 * CHARUCO_SQUARE_MM_MIN up to its largest with no gaps (checked by scripts/check-presets.ts), so snapping
 * is a clamp.
 */
export function snapSquareMm(
    raw: number,
    squaresX: number,
    squaresY: number,
    paperWMm: number,
    paperHMm: number,
    banner: boolean = true,
): number | null {
    const max = gridFeasibility(squaresX, squaresY, paperWMm, paperHMm, banner).maxSquareMm;
    return max === null ? null : Math.min(max, Math.max(CHARUCO_SQUARE_MM_MIN, Math.round(raw)));
}

const PAGE_COLOR_SAT = 78;

/**
 * Colour of chart sheet `sheetIndex1Based` of `totalPages`, hues spread evenly round the wheel at 78%
 * saturation and 40% lightness: the guide's blocks and the preview thumbnails' borders. RGB, because
 * svg2pdf does not read `hsl()`.
 */
export function sheetColorRgb(sheetIndex1Based: number, totalPages: number): [number, number, number] {
    const h = (360 * (sheetIndex1Based - 1)) / totalPages;
    const s = PAGE_COLOR_SAT / 100;
    const l = 0.4;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number): number => {
        const k = (n + h / 30) % 12;
        return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [f(0), f(8), f(4)];
}
