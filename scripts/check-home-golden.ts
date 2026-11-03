/**
 * Guards home ("My printer") output: renders the printed SVGs for every paper × distance preset, the
 * single-sheet presets again with the banner off, and a set of multi-sheet charts (with their assembly
 * guides) and compares each chart's SHA-256 with
 * `scripts/home-golden.json`. PDFs cannot be compared (CreationDate and /ID change on every export), but
 * they are built from these SVGs.
 *
 *   npm run check:home-golden             fail if any chart's SVG changed
 *   npm run check:home-golden -- --update rewrite the golden file (only for a deliberate output change)
 *
 * The real pipeline runs (QR, logo from `public/freemocap-logo.svg`, board, banner, guide); text is
 * measured with fixed Helvetica metrics, so the hashes do not depend on the machine's fonts. Outside Vite
 * the version is `0.0.0-dev`.
 */
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {PaperId} from '../src/print/papers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOLDEN_FILE = path.join(ROOT, 'scripts/home-golden.json');
const GOLDEN_NAME = path.relative(ROOT, GOLDEN_FILE);
const update = process.argv.includes('--update');

process.env.CHARUCO_LOGO_FILE = path.join(ROOT, 'public/freemocap-logo.svg');

const {
    maxSquareMmForGridAndPages,
    printedLayout,
    resolveDistancePrintPlan,
} = await import('../src/print/charucoLayout.js');
const {PAPERS, paperById} = await import('../src/print/papers.js');
const {renderCharucoPrintSvg} = await import('../src/print/svgDocument.js');

interface GoldenCase {
    key: string;
    paperId: PaperId;
    squaresX: number;
    squaresY: number;
    squareMm: number;
    banner: boolean;
}

const cases: GoldenCase[] = [];
for (const paper of PAPERS) {
    for (const distance of ['close', 'near', 'far'] as const) {
        const plan = resolveDistancePrintPlan(distance, paper.id);
        const squareMm = maxSquareMmForGridAndPages(plan.squaresX, plan.squaresY, paper.wMm, paper.hMm, plan.targetPages);
        if (squareMm === null) {
            throw new Error(`${paper.id} ${distance}: preset has no square length`);
        }
        cases.push({key: `${paper.id} ${distance}`, paperId: paper.id, ...plan, squareMm, banner: true});
    }
}
// The single-sheet presets with the banner off: the header line, and the board in the banner's room.
for (const paper of PAPERS) {
    for (const distance of ['close', 'near'] as const) {
        const plan = resolveDistancePrintPlan(distance, paper.id);
        const squareMm = maxSquareMmForGridAndPages(plan.squaresX, plan.squaresY, paper.wMm, paper.hMm, plan.targetPages, false);
        if (squareMm === null) {
            throw new Error(`${paper.id} ${distance} no banner: preset has no square length`);
        }
        cases.push({key: `${paper.id} ${distance} no banner`, paperId: paper.id, ...plan, squareMm, banner: false});
    }
}
// Two sheets and a guide with the banner, one sheet without it.
cases.push({key: 'a4 7x5 34mm no banner', paperId: 'a4', squaresX: 7, squaresY: 5, squareMm: 34, banner: false});
// Multi-sheet charts with an assembly guide, both orientations, partial edge sheets and the marker limit,
// then the guide's page numbers just above and just below their smallest readable size.
for (const [paperId, squaresX, squaresY, squareMm] of [
    ['a4', 12, 9, 50],
    ['letter', 9, 12, 50],
    ['a3', 7, 5, 120],
    ['tabloid', 20, 25, 44],
    ['letter', 40, 12, 30],
    ['a3', 2, 2, 225],
    ['letter', 2, 39, 189],
    ['letter', 2, 40, 189],
] as const) {
    cases.push({key: `${paperId} ${squaresX}x${squaresY} ${squareMm}mm`, paperId, squaresX, squaresY, squareMm, banner: true});
}

const actual: Record<string, string> = {};
for (const c of cases) {
    const paper = paperById(c.paperId);
    const tiling = printedLayout(c.squaresX, c.squaresY, c.squareMm, paper.wMm, paper.hMm, c.banner);
    if (!tiling) {
        throw new Error(`${c.key}: does not print`);
    }
    const {sheets: svgs, guide} = await renderCharucoPrintSvg({
        paperId: c.paperId,
        squaresX: c.squaresX,
        squaresY: c.squaresY,
        squareMm: c.squareMm,
        banner: c.banner,
        tiling,
    });
    // The logo markup keeps the file's line endings, which Git checks out as CRLF on Windows and LF elsewhere.
    const lf = (svg: string) => svg.replace(/\r\n?/g, '\n');
    const hash = createHash('sha256');
    if (guide) {
        hash.update(`guide\n${lf(guide)}\n`);
    }
    svgs.forEach((svg, i) => hash.update(`sheet ${i + 1}\n${lf(svg)}\n`));
    // The print-shop rich-black marker must never reach home output (it would print as 0 0 0.004 rg).
    if ([guide ?? '', ...svgs].some((svg) => svg.includes('rgb(0,0,1)'))) {
        console.error(`${c.key}: home output contains the print-shop rich-black fill rgb(0,0,1)`);
        process.exit(1);
    }
    // svg2pdf ignores `dominant-baseline` and browsers resolve it from the installed font, so every line must
    // carry an explicit baseline (`capTopToBaseline`, `centreToBaseline`) for Print and Save as PDF to agree.
    if ([guide ?? '', ...svgs].some((svg) => svg.includes('dominant-baseline'))) {
        console.error(`${c.key}: home output uses dominant-baseline`);
        process.exit(1);
    }
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
