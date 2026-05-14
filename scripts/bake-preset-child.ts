/**
 * One preset bake in an isolated Node process (`node --import tsx`): same module resolution
 * as the main CLI (tsx + .js specifiers → .ts sources).
 */
import {join} from 'node:path';

import {bakeOnePreset, patchDomGlobals} from './bake-preset-shared.js';
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
process.env.CHARUCO_LOGO_FILE = join(job.root, 'public', 'freemocap-logo.svg');
patchDomGlobals();

const {renderCharucoPrintPdf} = await import('../src/print/pdfDocument.js');
const result = await bakeOnePreset(job.distanceId, job.paper, job.outDir, renderCharucoPrintPdf);
process.stdout.write(`${JSON.stringify(result)}\n`);
