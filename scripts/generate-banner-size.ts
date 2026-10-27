/**
 * Sizes the origin-banner strip from the layout the sheets are drawn with (`src/print/originBannerLayout.ts`)
 * and writes `src/print/originBannerStrip.generated.ts`, which tiling and the renderer read.
 *
 *   npm run generate:banner   rewrite the generated file
 *   npm run check:banner      fail if it is stale (part of `npm run build`)
 *
 * Rerun after changing banner text (`labels.ts`), banner type, gaps, QR or logo size (`constants.ts`,
 * `skellyLogo.ts`, `originBannerLayout.ts`), the safe printing margins (`sheetGeometry.ts`), paper sizes, the
 * square-length or grid ranges, or the version.
 *
 * The strip is the exact banner height, with no spare line, so every input that can change the banner's
 * text is laid out — dev, release and any `VITE_APP_VERSION` override, every square length and grid
 * size — and the script fails if they do not all give the same height for a banner width.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(ROOT, 'src/print/originBannerStrip.generated.ts');
const OUT_NAME = path.relative(ROOT, OUT_FILE);
const check = process.argv.includes('--check');

/** Current table, or `null` when it is missing or does not load (e.g. merge-conflict markers). */
async function loadCurrentTable(): Promise<Readonly<Record<string, number>> | null> {
    try {
        return (await import(pathToFileURL(OUT_FILE).href)).ORIGIN_BANNER_STRIP_PX;
    } catch {
        return null;
    }
}

// The print modules below read the generated table (charucoLayout → tiling), so make sure it loads
// before importing them: a missing or broken table is replaced with an empty one to regenerate from.
let previous = await loadCurrentTable();
if (previous === null) {
    if (check) {
        console.error(`${OUT_NAME} is missing or unreadable: run \`npm run generate:banner\` and commit the result.`);
        process.exit(1);
    }
    fs.writeFileSync(
        OUT_FILE,
        'export const ORIGIN_BANNER_STRIP_PPM = 0;\nexport const ORIGIN_BANNER_STRIP_PX: Readonly<Record<string, number>> = {};\n',
    );
    previous = {};
}

const {displayAppVersion} = await import('../src/appVersion.js');
const {BOARD_GRID_MAX, BOARD_GRID_MIN, PAPER_OPTIONS} = await import('../src/print/charucoLayout.js');
const {
    CHARUCO_SQUARE_MM_MAX,
    CHARUCO_SQUARE_MM_MIN,
    ORIGIN_BANNER_VISUAL_SCALE,
    PIXELS_PER_MM,
    SKELLY_TOP_HEIGHT_MM,
    bannerWidthKey,
} = await import('../src/print/constants.js');
const {sheetSafeMarginsMm} = await import('../src/print/sheetGeometry.js');
const {helveticaTextWidthPx} = await import('../src/print/helveticaMetrics.js');
const {bannerLogoSizePx, layoutOriginBanner, originBannerStripPx} = await import('../src/print/originBannerLayout.js');
const {SKELLY_LOGO_NATURAL_W_OVER_H} = await import('../src/print/skellyLogo.js');

const pkgVersion: string = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
/** Dev servers print `DEV_APP_VERSION` from `vite.config.ts`; builds print the package version or the override. */
const VERSIONS = [
    ...new Set(
        ['develop', pkgVersion, process.env.VITE_APP_VERSION?.trim()]
            .filter((v): v is string => Boolean(v))
            .map(displayAppVersion),
    ),
];

/**
 * One value per distinct printed width: layout depends on text only through Helvetica widths, so values
 * whose digits measure the same lay out identically.
 */
function widthRepresentatives(min: number, max: number): number[] {
    const byWidth = new Map<number, number>();
    for (let v = min; v <= max; v++) {
        const w = helveticaTextWidthPx(String(v), 1000);
        if (!byWidth.has(w)) {
            byWidth.set(w, v);
        }
    }
    return [...byWidth.values()];
}

const squareMms = widthRepresentatives(CHARUCO_SQUARE_MM_MIN, CHARUCO_SQUARE_MM_MAX);
const gridCounts = widthRepresentatives(BOARD_GRID_MIN, BOARD_GRID_MAX);
const logo = bannerLogoSizePx(SKELLY_TOP_HEIGHT_MM, SKELLY_LOGO_NATURAL_W_OVER_H);

/**
 * Every banner width: each paper in portrait and landscape, less that sheet's left and right safe
 * margins. Sheets with the same banner width share a row; each is laid out, as their margins differ.
 */
const sheets = new Map<string, {bannerWMm: number; sizes: {widthMm: number; heightMm: number}[]; names: string[]}>();
for (const paper of PAPER_OPTIONS) {
    for (const [widthMm, heightMm, orientation] of [
        [paper.wMm, paper.hMm, 'portrait'],
        [paper.hMm, paper.wMm, 'landscape'],
    ] as const) {
        const m = sheetSafeMarginsMm(widthMm, heightMm);
        const bannerWMm = widthMm - m.left - m.right;
        const key = bannerWidthKey(bannerWMm);
        const entry = sheets.get(key) ?? {bannerWMm, sizes: [], names: []};
        entry.sizes.push({widthMm, heightMm});
        entry.names.push(`${paper.id} ${orientation}`);
        sheets.set(key, entry);
    }
}

type Layout = NonNullable<ReturnType<typeof layoutOriginBanner>>;

/** Which banner column reaches lowest, i.e. sets the strip height. */
function heightSetBy(l: Layout): string {
    const bottoms: [string, number][] = [
        ['instructions', l.instBodyY + l.instLines.length * l.bodyLineLead],
        ['chart info', l.infoBottom],
        ['QR code', l.bannerTitleTop + l.qrSizePx],
        ['logo', l.bannerTitleTop + logo.heightPx],
    ];
    const lowest = Math.max(...bottoms.map(([, b]) => b));
    return bottoms.filter(([, b]) => b === lowest).map(([name]) => name).join(' and ');
}

const failures: string[] = [];
const rows: {key: string; px: number; comment: string}[] = [];
for (const [key, {sizes, names}] of [...sheets].sort((a, b) => a[1].bannerWMm - b[1].bannerWMm)) {
    const heights = new Map<number, string[]>();
    const lineCounts = new Set<number>();
    let sample: Layout | null = null;
    for (const [{widthMm, heightMm}, version] of sizes.flatMap((s) => VERSIONS.map((v) => [s, v] as const))) {
        for (const squareLengthMm of squareMms) {
            for (const squaresX of gridCounts) {
                for (const squaresY of gridCounts) {
                    const inputs = `${widthMm}×${heightMm} mm sheet, v${version}, ${squareLengthMm} mm, ${squaresX}×${squaresY}`;
                    const layout = layoutOriginBanner({
                        paperWMm: widthMm,
                        paperHMm: heightMm,
                        typeScale: ORIGIN_BANNER_VISUAL_SCALE,
                        version,
                        squareLengthMm,
                        squaresX,
                        squaresY,
                        logoWidthPx: logo.widthPx,
                        logoHeightPx: logo.heightPx,
                    });
                    if (!layout) {
                        failures.push(`${key} mm (${names.join(', ')}), ${inputs}: banner columns do not fit side by side`);
                        continue;
                    }
                    sample ??= layout;
                    lineCounts.add(layout.instLines.length);
                    const px = originBannerStripPx(layout);
                    heights.set(px, [...(heights.get(px) ?? []), inputs]);
                }
            }
        }
    }
    if (heights.size > 1) {
        const detail = [...heights].map(([px, inputs]) => `${px / PIXELS_PER_MM} mm for ${inputs.slice(0, 3).join('; ')}`);
        failures.push(`${key} mm (${names.join(', ')}): banner height varies with the chart, so no single height is exact: ${detail.join(' | ')}`);
        continue;
    }
    const [px] = [...heights.keys()];
    if (px === undefined || !sample) {
        continue;
    }
    const lines = [...lineCounts].sort((a, b) => a - b).join('–');
    const comment = `${(px / PIXELS_PER_MM).toFixed(2)} mm: ${names.join(', ')}; ${lines} instruction lines, height set by ${heightSetBy(sample)}`;
    rows.push({key, px, comment});
    const was = previous[key];
    const change = was === px ? '' : `  (was ${was === undefined ? 'missing' : `${(was / PIXELS_PER_MM).toFixed(2)} mm`})`;
    console.log(`${key.padStart(6)} mm  ${String(px).padStart(4)} px  ${comment}${change}`);
}
for (const key of Object.keys(previous).filter((k) => !sheets.has(k))) {
    console.log(`${key.padStart(6)} mm  removed (no paper prints at this width)`);
}

if (failures.length > 0) {
    console.error(`\nBanner size failed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
}

const generated = `// Generated by \`npm run generate:banner\` (scripts/generate-banner-size.ts) from the banner layout in
// \`originBannerLayout.ts\`. Do not edit by hand.

/** Px per mm the heights below were laid out at (\`PIXELS_PER_MM\`). */
export const ORIGIN_BANNER_STRIP_PPM = ${PIXELS_PER_MM};

/**
 * Exact origin-banner strip height (px at {@link ORIGIN_BANNER_STRIP_PPM}), from the safe top margin
 * through the gap below the banner, keyed by banner width in mm (\`bannerWidthKey\`): the sheet width
 * less its left and right safe margins (\`sheetGeometry.ts\`).
 */
export const ORIGIN_BANNER_STRIP_PX: Readonly<Record<string, number>> = {
${rows.map((r) => `    '${r.key}': ${r.px}, // ${r.comment}`).join('\n')}
};
`;

const current = fs.readFileSync(OUT_FILE, 'utf8').replace(/\r\n/g, '\n');
if (check) {
    if (current !== generated) {
        console.error(`\n${OUT_NAME} is stale: run \`npm run generate:banner\` and commit the result.`);
        process.exit(1);
    }
    console.log(`\n${OUT_NAME} is up to date.`);
} else if (current === generated) {
    console.log(`\n${OUT_NAME} unchanged.`);
} else {
    fs.writeFileSync(OUT_FILE, generated);
    console.log(`\nWrote ${OUT_NAME}.`);
}
