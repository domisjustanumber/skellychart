/**
 * Build guard: every working-distance preset must print exactly its target page count, at the largest
 * square length that does so, and that square must meet the distance's minimum square length. Every
 * stop of the sheets stepper, for every paper, grid and distance, must print exactly the page count it
 * names, at or above the distance minimum, ending at one square per sheet. Every preset and every grid
 * the X / Y sliders allow must fit the 250-marker dictionary.
 */
import {
    BOARD_GRID_MAX,
    BOARD_GRID_MIN,
    BOARD_MARKERS_MAX,
    PAPER_OPTIONS,
    boardGridAxisMax,
    charucoMarkerCount,
    computeEffectivePrintLayout,
    maxSquareMmForGridAndPages,
    resolveDistancePrintPlan,
    pageStepNeighbours,
    steppablePageCounts,
    validTargetPageCountsForGrid,
    workingDistanceMinSquareMm,
    type WorkingDistanceTierId,
} from '../src/print/charucoLayout.js';

const DISTANCES: WorkingDistanceTierId[] = ['close', 'near', 'far'];
const failures: string[] = [];

for (const paper of PAPER_OPTIONS) {
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
        const printed = computeEffectivePrintLayout(plan.squaresX, plan.squaresY, squareMm, paper.wMm, paper.hMm);
        if (printed?.pageCount !== plan.targetPages) {
            failures.push(`${label}: ${squareMm} mm prints ${printed?.pageCount ?? 'nothing'}`);
        }
        console.log(`${label}: ${squareMm} mm`);
    }
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
for (const paper of PAPER_OPTIONS) {
    for (let sx = BOARD_GRID_MIN; sx <= BOARD_GRID_MAX; sx++) {
        for (let sy = BOARD_GRID_MIN; sy <= boardGridAxisMax(sx); sy++) {
            for (const distance of DISTANCES) {
                const minMm = workingDistanceMinSquareMm(distance);
                const steps = steppablePageCounts(sx, sy, paper.wMm, paper.hMm, minMm);
                const label = `stepper ${paper.id} ${sx}×${sy} ${distance}`;
                if (steps.length === 0) {
                    failures.push(`${label}: no stops`);
                    continue;
                }
                const offered = validTargetPageCountsForGrid(sx, sy, paper.wMm, paper.hMm, minMm);
                if (steps[0]!.pages !== offered[0]) {
                    failures.push(`${label}: fewest stop is ${steps[0]!.pages}, not the fewest printable ${offered[0]}`);
                }
                steps.forEach((step, i) => {
                    const printed = computeEffectivePrintLayout(sx, sy, step.squareMm, paper.wMm, paper.hMm);
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
