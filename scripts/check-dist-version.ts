/**
 * Guardrail run by `postbuild`: the production bundle must embed the app version and
 * must retain neither the dev fallback nor the `define` placeholder.
 *
 * Catches a build where Vite's `define` silently stopped replacing `__APP_VERSION__`;
 * the printed chart QR would otherwise carry `0.0.0-dev` instead of a release version.
 */
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(repoRoot, 'dist');

/** Honours the same one-off override as `vite.config.ts`. */
const expectedVersion =
    process.env.VITE_APP_VERSION?.trim() ||
    (
        JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
            version: string;
        }
    ).version;

function fail(message: string): never {
    console.error(`check:dist: ${message}`);
    process.exit(1);
}

function walk(dir: string): string[] {
    return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
        const full = join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
    });
}

if (!existsSync(distDir)) {
    fail('dist/ not found — run the build first');
}

const jsFiles = walk(distDir).filter((file) => file.endsWith('.js'));
if (jsFiles.length === 0) {
    fail('dist/ contains no JavaScript bundles');
}

// Minifiers may rewrite the injected string literal as a template literal, so match
// the bare version, bounded so `1.0.0` does not match inside `1.0.0-dev` or a URL.
const expectedPattern = new RegExp(
    `(?<![\\w.-])${expectedVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`,
);

let embedded = false;
for (const file of jsFiles) {
    // Inline sourcemaps would otherwise match the pre-transform source text.
    const code = readFileSync(file, 'utf8').replace(/\/\/# sourceMappingURL=data:[^\n]*/g, '');
    const rel = relative(repoRoot, file);
    if (code.includes('__APP_VERSION__')) {
        fail(`${rel} still contains the __APP_VERSION__ placeholder`);
    }
    if (code.includes('0.0.0-dev')) {
        fail(`${rel} contains the dev fallback version 0.0.0-dev`);
    }
    if (expectedPattern.test(code)) {
        embedded = true;
    }
}
if (!embedded) {
    fail(`no bundle embeds ${JSON.stringify(expectedVersion)} — Vite define did not reach the app`);
}

// The print-shop glyph outlines come from Arimo (OFL-1.1): the chunk that ships them must keep the notice,
// and they must stay out of the main bundle (it is loaded only for print-shop boards).
const generatedOutlines = readFileSync(join(repoRoot, 'src/print/glyphOutlines.generated.ts'), 'utf8');
const outlineOfH = /"H":"([^"]+)"/.exec(generatedOutlines)?.[1];
if (!outlineOfH) {
    fail('src/print/glyphOutlines.generated.ts has no outline for "H"');
}
const outlineChunks = jsFiles.filter((file) => readFileSync(file, 'utf8').includes(outlineOfH));
if (outlineChunks.length === 0) {
    fail('no bundle contains the print-shop glyph outlines');
}
for (const file of outlineChunks) {
    const code = readFileSync(file, 'utf8');
    if (!code.includes('@license OFL-1.1')) {
        fail(`${relative(repoRoot, file)} ships the Arimo glyph outlines without their OFL-1.1 notice`);
    }
}
const entryChunk = /<script[^>]+src="\.?\/?(assets\/[^"]+\.js)"/.exec(readFileSync(join(distDir, 'index.html'), 'utf8'))?.[1];
if (entryChunk && outlineChunks.some((file) => file.endsWith(entryChunk.split('/').pop()!))) {
    fail('the glyph outlines are in the main bundle; load print-shop rendering with import()');
}

const htmlPath = join(distDir, 'index.html');
if (!existsSync(htmlPath)) {
    fail('dist/index.html not found');
}
const html = readFileSync(htmlPath, 'utf8');
if (html.includes('/src/')) {
    fail('dist/index.html references /src/ — this would 404 on GitHub Pages');
}
if (!html.includes('assets/')) {
    fail('dist/index.html does not reference built assets');
}

console.log(
    `check:dist: ${expectedVersion} embedded in ${jsFiles.length} JS files; index.html OK`,
);
