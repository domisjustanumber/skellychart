/**
 * Computes one paper preset (stdout = JSON with base64 blobs). Spawned by generate-tiling-feasibility.ts.
 */
import {computePaperFeasibilityBuffers, paperBuffersToBase64} from './feasibilityCompute.js';

type PaperArg = {id: string; wMm: number; hMm: number};

const paper = JSON.parse(process.argv[2]!) as PaperArg;
const buffers = computePaperFeasibilityBuffers(paper.wMm, paper.hMm);
const b64 = paperBuffersToBase64(buffers);
process.stdout.write(JSON.stringify({paperId: paper.id, ...b64}));
