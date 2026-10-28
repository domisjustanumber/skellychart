/**
 * Guards home ("My printer") output: renders the printed SVGs for every paper × distance preset and a
 * set of multi-sheet charts (with their assembly guides) and compares each chart's SHA-256 with
 * `scripts/home-golden.json`. PDFs cannot be compared (CreationDate and /ID change on every export), but
 * they are built from these SVGs.
 *
 *   npm run check:home-golden             fail if any chart's SVG changed
 *   npm run check:home-golden -- --update rewrite the golden file (only for a deliberate output change)
 *
 * The real pipeline runs (QR, logo from `public/freemocap-logo.svg`, board, banner, guide). Only the
 * canvas text measure used for tape labels is stubbed, with fixed Helvetica metrics, so the hashes do not
 * depend on the machine's fonts. Outside Vite the version is `0.0.0-dev`.
 */
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {helveticaTextWidthPx} from '../src/print/helveticaMetrics.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOLDEN_FILE = path.join(ROOT, 'scripts/home-golden.json');
const GOLDEN_NAME = path.relative(ROOT, GOLDEN_FILE);
const update = process.argv.includes('--update');

process.env.CHARUCO_LOGO_FILE = path.join(ROOT, 'public/freemocap-logo.svg');

/** Deterministic stand-in for the tape labels' canvas measure. */
const measureContext = {
    font: '10px sans-serif',
    measureText(text: string) {
        const fontPx = Number(/^([\d.]+)px/.exec(this.font)?.[1] ?? 10);
        return {
            width: helveticaTextWidthPx(text, fontPx),
            actualBoundingBoxAscent: 0.75 * fontPx,
            actualBoundingBoxDescent: 0.25 * fontPx,
        };
    },
};
(globalThis as {document?: unknown}).document = {
    createElement: () => ({getContext: () => measureContext}),
};

const {
    PAPER_OPTIONS,
    computeEffectivePrintLayout,
    maxSquareMmForGridAndPages,
    resolveDistancePrintPlan,
} = await import('../src/print/charucoLayout.js');
const {CHARUCO_MARKER_LENGTH_RATIO} = await import('../src/print/constants.js');
const {buildPageSpecs, nominalPaperToPdfDimensionsMm} = await import('../src/print/tiling.js');
const {renderCharucoPrintSvg} = await import('../src/print/svgDocument.js');

const SOURCE_URL = 'https://skelly.cam/c/';

interface GoldenCase {
    key: string;
    paperId: string;
    squaresX: number;
    squaresY: number;
    squareMm: number;
}

const cases: GoldenCase[] = [];
for (const paper of PAPER_OPTIONS) {
    for (const distance of ['close', 'near', 'far'] as const) {
        const plan = resolveDistancePrintPlan(distance, paper.id);
        const squareMm = maxSquareMmForGridAndPages(plan.squaresX, plan.squaresY, paper.wMm, paper.hMm, plan.targetPages);
        if (squareMm === null) {
            throw new Error(`${paper.id} ${distance}: preset has no square length`);
        }
        cases.push({key: `${paper.id} ${distance}`, paperId: paper.id, ...plan, squareMm});
    }
}
// Multi-sheet charts with an assembly guide, both orientations, partial edge sheets and the marker limit.
for (const [paperId, squaresX, squaresY, squareMm] of [
    ['a4', 12, 9, 50],
    ['letter', 9, 12, 50],
    ['a3', 7, 5, 120],
    ['tabloid', 20, 25, 44],
    ['letter', 40, 12, 30],
    ['a3', 2, 2, 225],
] as const) {
    cases.push({key: `${paperId} ${squaresX}x${squaresY} ${squareMm}mm`, paperId, squaresX, squaresY, squareMm});
}

const actual: Record<string, string> = {};
for (const c of cases) {
    const paper = PAPER_OPTIONS.find((p) => p.id === c.paperId)!;
    const tiling = computeEffectivePrintLayout(c.squaresX, c.squaresY, c.squareMm, paper.wMm, paper.hMm);
    if (!tiling) {
        throw new Error(`${c.key}: does not print`);
    }
    const {paperWMm, paperHMm} = nominalPaperToPdfDimensionsMm(paper.wMm, paper.hMm, tiling);
    const {pages: svgs, guide} = await renderCharucoPrintSvg({
        paperId: c.paperId,
        squaresX: c.squaresX,
        squaresY: c.squaresY,
        squareLengthMm: c.squareMm,
        paperWMm,
        paperHMm,
        markerLengthRatio: CHARUCO_MARKER_LENGTH_RATIO,
        tiling,
        pages: buildPageSpecs(c.squaresX, c.squaresY, tiling).pages,
        documentationSourceUrl: SOURCE_URL,
        cooperativeYield: false,
    });
    // The logo markup keeps the file's line endings, which Git checks out as CRLF on Windows and LF elsewhere.
    const lf = (svg: string) => svg.replace(/\r\n?/g, '\n');
    const hash = createHash('sha256');
    if (guide) {
        hash.update(`guide ${guide.paperWMm}x${guide.paperHMm}\n${lf(guide.svg)}\n`);
    }
    svgs.forEach((svg, i) => hash.update(`sheet ${i + 1}\n${lf(svg)}\n`));
    actual[`${c.key} (${svgs.length} sheet${svgs.length === 1 ? '' : 's'}${guide ? ' + guide' : ''})`] =
        hash.digest('hex');
}

if (update) {
    fs.writeFileSync(GOLDEN_FILE, `${JSON.stringify(actual, null, 4)}\n`);
    console.log(`check:home-golden: wrote ${Object.keys(actual).length} charts to ${GOLDEN_NAME}`);
    process.exit(0);
}

let golden: Record<string, string>;
try {
    golden = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8'));
} catch {
    console.error(`${GOLDEN_NAME} is missing or unreadable: run \`npm run check:home-golden -- --update\`.`);
    process.exit(1);
}
const failures = [
    ...Object.keys(actual)
        .filter((k) => golden[k] !== actual[k])
        .map((k) => (k in golden ? `changed: ${k}` : `new: ${k}`)),
    ...Object.keys(golden)
        .filter((k) => !(k in actual))
        .map((k) => `missing: ${k}`),
];
if (failures.length > 0) {
    console.error(
        `Home output differs from ${GOLDEN_NAME}:\n  ${failures.join('\n  ')}\n` +
            'If the change is deliberate, run `npm run check:home-golden -- --update` and commit the result.',
    );
    process.exit(1);
}
console.log(`check:home-golden: ${Object.keys(actual).length} charts match`);
