/**
 * One preset bake in an isolated Node process (`node --import tsx`): same module resolution
 * as the main CLI (tsx + .js specifiers → .ts sources).
 */
import {bakeLogoEnv, bakeOnePreset, patchDomGlobals} from './bake-preset-shared.js';
import type {DistanceId, PaperOption} from './bake-preset-shared.js';

type JobPayload = {
    outDir: string;
    root: string;
    distanceId: DistanceId;
    paper: PaperOption;
};

const raw = process.argv[2];
if (raw === undefined) {
    throw new Error('bake-preset-child: missing job JSON argv');
}

const job = JSON.parse(raw) as JobPayload;
bakeLogoEnv(job.root);
patchDomGlobals();

const {renderCharucoPrintSvgZip, renderCharucoPrintSvg} = await import('../src/print/svgDocument.js');
const result = await bakeOnePreset(
    job.distanceId,
    job.paper,
    job.outDir,
    renderCharucoPrintSvgZip,
    renderCharucoPrintSvg,
);
process.stdout.write(`${JSON.stringify(result)}\n`);
