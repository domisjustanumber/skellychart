/**
 * Build guard: every working-distance preset must print exactly its target page count, at the largest
 * square length that does so, and that square must meet the distance's minimum square length.
 */
import {
    PAPER_OPTIONS,
    computeEffectivePrintLayout,
    maxSquareMmForGridAndPages,
    resolveDistancePrintPlan,
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

if (failures.length > 0) {
    console.error(`\nPreset check failed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
}
