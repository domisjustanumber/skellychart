/**
 * Build guard: every working-distance preset must print exactly its target page count, at the largest
 * square length that does so, and that square must meet the distance's minimum square length. Every
 * stop of the sheets stepper, for every paper, grid and distance, must print exactly the page count it
 * names, at or above the distance minimum, ending at one square per sheet. Every grid prints every square
 * length up to its largest, with no gaps. Every preset and every grid the X / Y sliders allow must fit the
 * 250-marker dictionary. Tiling reserves the origin banner for the version the build prints, and only on a
 * single-sheet chart. Every paper's link code is a unique single digit.
 */
import './useBuildAppVersion.js';
import {MM_HEADER_CONTENT_TOP_MM, ORIGIN_CORNER_MARKER_TOP_ROOM_MM} from '../src/print/constants.js';
import {originBannerReserveMm} from '../src/print/originBannerLayout.js';
import {sheetSafeMarginsMm} from '../src/print/sheetGeometry.js';
import {
    BOARD_GRID_MAX,
    BOARD_GRID_MIN,
    BOARD_MARKERS_MAX,
    CHARUCO_SQUARE_MM_MAX,
    CHARUCO_SQUARE_MM_MIN,
    boardGridAxisMax,
    charucoMarkerCount,
    maxSquareMmForGridAndPages,
    printedLayout,
    resolveDistancePrintPlan,
    pageStepNeighbours,
    steppablePageCounts,
    workingDistanceMinSquareMm,
    WORKING_DISTANCES,
} from '../src/print/charucoLayout.js';
import {gridFeasibility} from '../src/print/feasibilityRules.js';
import {PAPERS} from '../src/print/papers.js';

const DISTANCES = WORKING_DISTANCES.map((d) => d.id);
const failures: string[] = [];

// The link's `p` field is one digit per paper, printed on charts forever.
PAPERS.forEach((paper, i) => {
    if (!/^\d$/.test(String(paper.linkCode)) || PAPERS.findIndex((p) => p.linkCode === paper.linkCode) !== i) {
        failures.push(`${paper.id}: link code ${paper.linkCode} is not a unique single digit`);
    }
});

for (const paper of PAPERS) {
    for (const distance of DISTANCES) {
        const plan = resolveDistancePrintPlan(distance, paper.id);
        const label = `${paper.id} ${distance} ${plan.squaresX}×${plan.squaresY} → ${plan.targetPages} page(s)`;
        if (charucoMarkerCount(plan.squaresX, plan.squaresY) > BOARD_MARKERS_MAX) {
            failures.push(`${label}: needs more than ${BOARD_MARKERS_MAX} markers`);
        }
        const squareMm = maxSquareMmForGridAndPages(plan.squaresX, plan.squaresY, paper.wMm, paper.hMm, plan.targetPages);
        if (squareMm === null) {
            failures.push(`${label}: no square length prints on exactly ${plan.targetPages} page(s)`);
            continue;
        }
        const minMm = workingDistanceMinSquareMm(distance);
        if (squareMm < minMm) {
            failures.push(`${label}: ${squareMm} mm is below the ${distance} minimum of ${minMm} mm`);
        }
        const printed = printedLayout(plan.squaresX, plan.squaresY, squareMm, paper.wMm, paper.hMm);
        if (printed?.pageCount !== plan.targetPages) {
            failures.push(`${label}: ${squareMm} mm prints ${printed?.pageCount ?? 'nothing'}`);
        }
        console.log(`${label}: ${squareMm} mm`);
    }
}

// A multi-sheet chart tiled with the banner's strip reserved prints its first sheet without it, so that
// sheet's board region (below the header, plus the corner marker's room) must be at least as tall.
for (const paper of PAPERS) {
    for (const [w, h] of [[paper.wMm, paper.hMm], [paper.hMm, paper.wMm]] as const) {
        const reserveMm = originBannerReserveMm(w, h);
        const neededMm = MM_HEADER_CONTENT_TOP_MM + ORIGIN_CORNER_MARKER_TOP_ROOM_MM - sheetSafeMarginsMm(w, h).top;
        if (reserveMm < neededMm) {
            failures.push(`banner strip on ${paper.id} ${w}×${h} is ${reserveMm} mm, less than the ${neededMm} mm header and marker room`);
        }
    }
}
// A4 2×3 at 79 mm fits one sheet only without the banner: two sheets, and no blank strip on the first.
const a4 = PAPERS.find((p) => p.id === 'a4')!;
const noStrip = printedLayout(2, 3, 79, a4.wMm, a4.hMm);
if (noStrip?.pageCount !== 2 || noStrip.bannerReserveMm !== 0) {
    failures.push(`a4 2×3 at 79 mm prints ${noStrip?.pageCount ?? 'nothing'} sheet(s) with a ${noStrip?.bannerReserveMm} mm banner strip, not 2 with none`);
}

// The X / Y end-stop is exactly the largest count whose board fits the marker dictionary.
for (let other = BOARD_GRID_MIN; other <= BOARD_GRID_MAX; other++) {
    const max = boardGridAxisMax(other);
    const fits = (n: number) => charucoMarkerCount(n, other) <= BOARD_MARKERS_MAX;
    if (max < BOARD_GRID_MIN || !fits(max) || (max < BOARD_GRID_MAX && fits(max + 1))) {
        failures.push(`grid end-stop with ${other} on the other axis is ${max}, not the largest that fits`);
    }
}

let stepperChecks = 0;
for (const paper of PAPERS) {
    for (let sx = BOARD_GRID_MIN; sx <= BOARD_GRID_MAX; sx++) {
        for (let sy = BOARD_GRID_MIN; sy <= boardGridAxisMax(sx); sy++) {
            // Snapping a square length is a clamp, so every length up to the grid's largest must print. With
            // the far stepper below (its stops reach the far minimum), snapping never changes a distance band,
            // which the X / Y, link and paper paths rely on.
            const {maxSquareMm} = gridFeasibility(sx, sy, paper.wMm, paper.hMm);
            for (let s = CHARUCO_SQUARE_MM_MIN; s <= CHARUCO_SQUARE_MM_MAX; s++) {
                const printed = printedLayout(sx, sy, s, paper.wMm, paper.hMm);
                const prints = printed !== null;
                if (prints !== (maxSquareMm !== null && s <= maxSquareMm)) {
                    failures.push(`grid ${paper.id} ${sx}×${sy}: ${s} mm ${prints ? 'prints' : 'does not print'}, but the largest square is ${maxSquareMm} mm`);
                    break;
                }
                // The banner strip is reserved exactly when the chart is a single sheet (it carries the banner).
                if (printed && (printed.bannerReserveMm > 0) !== (printed.pageCount === 1)) {
                    failures.push(`grid ${paper.id} ${sx}×${sy}: ${s} mm prints ${printed.pageCount} sheet(s) with a ${printed.bannerReserveMm} mm banner strip`);
                    break;
                }
            }
            for (const distance of DISTANCES) {
                const minMm = workingDistanceMinSquareMm(distance);
                const steps = steppablePageCounts(sx, sy, paper.wMm, paper.hMm, minMm);
                const label = `stepper ${paper.id} ${sx}×${sy} ${distance}`;
                if (steps.length === 0) {
                    failures.push(`${label}: no stops`);
                    continue;
                }
                const offered = gridFeasibility(sx, sy, paper.wMm, paper.hMm)
                    .steps.filter((s) => s.squareMm >= minMm)
                    .map((s) => s.pages);
                if (steps[0]!.pages !== offered[0]) {
                    failures.push(`${label}: fewest stop is ${steps[0]!.pages}, not the fewest printable ${offered[0]}`);
                }
                steps.forEach((step, i) => {
                    const printed = printedLayout(sx, sy, step.squareMm, paper.wMm, paper.hMm);
                    if (printed?.pageCount !== step.pages || step.squareMm < minMm) {
                        failures.push(`${label}: stop ${step.pages} page(s) at ${step.squareMm} mm is not printable here`);
                    }
                    if (i > 0) {
                        const prev = steps[i - 1]!;
                        const gain = step.squareMm - prev.squareMm;
                        const isLast = i === steps.length - 1;
                        if (step.pages <= prev.pages || gain <= 0) {
                            failures.push(`${label}: stops not ascending at ${step.pages} page(s)`);
                        } else if (!isLast && gain < Math.max(1, Math.ceil(0.03 * prev.squareMm))) {
                            failures.push(`${label}: near-duplicate stop ${step.pages} page(s) (+${gain} mm) not skipped`);
                        }
                    }
                    // Stepping from any printable count between stops lands on the neighbouring stops.
                    const {fewer, more} = pageStepNeighbours(steps, step.pages);
                    if (fewer !== (steps[i - 1] ?? null) || more !== (steps[i + 1] ?? null)) {
                        failures.push(`${label}: wrong neighbours at ${step.pages} page(s)`);
                    }
                    stepperChecks++;
                });
                for (const p of offered) {
                    const {fewer, more} = pageStepNeighbours(steps, p);
                    if ((fewer && fewer.pages >= p) || (more && more.pages <= p) || (!more && p < steps[steps.length - 1]!.pages)) {
                        failures.push(`${label}: wrong neighbours from skipped count ${p}`);
                    }
                }
                const last = steps[steps.length - 1]!;
                if (last.pages !== sx * sy) {
                    failures.push(`${label}: most is ${last.pages} page(s), not one square per sheet (${sx * sy})`);
                }
            }
        }
    }
}
console.log(`sheets stepper: ${stepperChecks} stops checked`);

if (failures.length > 0) {
    console.error(`\nPreset check failed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
}
