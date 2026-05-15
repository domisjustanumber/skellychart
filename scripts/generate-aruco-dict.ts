/**
 * Writes `src/generated/dict4x4_250_rot0.ts` from `scripts/data/dict4x4_250_rot0_first2.json`:
 * first two bytes per marker id (rotation 0), OpenCV `DICT_4X4_250`.
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const dataPath = join(__dirname, 'data', 'dict4x4_250_rot0_first2.json');
const bytes = JSON.parse(readFileSync(dataPath, 'utf8')) as number[];

const expected = 250 * 2;
if (bytes.length !== expected) {
    throw new Error(`Expected ${expected} bytes (250 markers × 2), got ${bytes.length}`);
}

const outDir = join(repoRoot, 'src', 'generated');
mkdirSync(outDir, {recursive: true});
const outPath = join(outDir, 'dict4x4_250_rot0.ts');

writeFileSync(
    outPath,
    `/** Auto-generated: first 2 bytes (rotation 0) per marker, OpenCV DICT_4X4_250. */
export const DICT_4X4_250_ROT0_BYTES = new Uint8Array([${bytes.join(',')}]);
`,
    'utf8',
);
console.log(`Wrote ${outPath}`);
