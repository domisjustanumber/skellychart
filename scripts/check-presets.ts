/**
 * Build guard: every working-distance preset must print exactly its target page count, at the largest
 * square length that does so, and that square must meet the distance's minimum square length. Every
 * stop of the sheets stepper, for every paper, grid and distance, must print exactly the page count it
 * names, at or above the distance minimum, ending at one square per sheet.
 */
import {
    BOARD_GRID_MAX,
    BOARD_GRID_MIN,
    PAPER_OPTIONS,
    computeEffectivePrintLayout,
    maxSquareMmForGridAndPages,
    resolveDistancePrintPlan,
    steppablePageCounts,
    workingDistanceMinSquareMm,
    type WorkingDistanceTierId,
} from '../src/print/charucoLayout.js';

const DISTANCES: WorkingDistanceTierId[] = ['close', 'near', 'far'];
const failures: string[] = [];

for (const paper of PAPER_OPTIONS) {
    for (const distance of DISTANCES) {
        const plan = resolveDistancePrintPlan(distance, paper.id);
        const label = `${paper.id} ${distance} ${plan.squaresX}×${plan.squaresY} → ${plan.targetPages} page(s)`;
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

let stepperChecks = 0;
for (const paper of PAPER_OPTIONS) {
    for (let sx = BOARD_GRID_MIN; sx <= BOARD_GRID_MAX; sx++) {
        for (let sy = BOARD_GRID_MIN; sy <= BOARD_GRID_MAX; sy++) {
            for (const distance of DISTANCES) {
                const minMm = workingDistanceMinSquareMm(distance);
                const steps = steppablePageCounts(sx, sy, paper.wMm, paper.hMm, minMm);
                const label = `stepper ${paper.id} ${sx}×${sy} ${distance}`;
                if (steps.length === 0) {
                    failures.push(`${label}: no stops`);
                    continue;
                }
                steps.forEach((step, i) => {
                    const printed = computeEffectivePrintLayout(sx, sy, step.squareMm, paper.wMm, paper.hMm);
                    if (printed?.pageCount !== step.pages) {
                        failures.push(`${label}: ${step.pages} page(s) at ${step.squareMm} mm prints ${printed?.pageCount}`);
                    }
                    if (step.squareMm < minMm) {
                        failures.push(`${label}: ${step.squareMm} mm is below the ${minMm} mm minimum`);
                    }
                    if (i > 0 && (step.pages <= steps[i - 1]!.pages || step.squareMm <= steps[i - 1]!.squareMm)) {
                        failures.push(`${label}: stops not ascending at ${step.pages} page(s)`);
                    }
                    stepperChecks++;
                });
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
