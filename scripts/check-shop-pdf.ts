/**
 * Print-shop PDF check: builds real PDFs in a browser (svg2pdf needs one) through
 * `scripts/shop-pdf-harness/`, then inspects them in Node. Run with `npm run check:shop-pdf` (also part of
 * `npm run check:all`); it is not in `build`, since it needs Chrome (or set PLAYWRIGHT_CHANNEL=msedge).
 *
 * For A3, 24 × 36 in and 36 × 48 in, each with standard bleed, exact trim, 10 mm bleed and standard bleed
 * with crop marks, it asserts: one page; MediaBox, TrimBox and BleedBox as computed; no fonts, text or
 * images; PrintScaling None; black as DeviceGray 0 and no ExtGState; crop-mark endpoints exactly b and
 * b + 6 mm outside the TrimBox in page space (so the board is 1:1); and the chart link in the keywords
 * reopens the board.
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inflateSync} from 'node:zlib';
import {chromium} from 'playwright-core';
import {createServer} from 'vite';
import {parseCharucoQrSearchParams, type ShopPrintOptions, type ShopSizeChoice} from '../src/print/charucoDocUrl.js';
import {maxShopSquareMm} from '../src/print/shopLayout.js';
import {bleedMmForUnit, SHOP_CROP_MARK_LENGTH_MM} from '../src/print/shopSizes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PT = 72 / 25.4;
const TOL_PT = 0.02;
const failures: string[] = [];

interface Built {
    pdf: string;
    mediaMm: {w: number; h: number};
    trimBoxMm: {x: number; y: number; w: number; h: number};
    bleedBoxMm: {x: number; y: number; w: number; h: number};
    chartUrl: string;
}

/** Every stream's dictionary and (inflated) bytes, as latin1 text. */
function pdfStreams(pdf: Buffer): {dict: string; data: string}[] {
    const text = pdf.toString('latin1');
    const out: {dict: string; data: string}[] = [];
    const re = /<<((?:[^<>]|<<[^<>]*>>)*)>>\s*stream\r?\n/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
        const length = Number(/\/Length (\d+)/.exec(m[1]!)?.[1]);
        const start = m.index + m[0].length;
        const raw = pdf.subarray(start, start + length);
        const data = /\/FlateDecode/.test(m[1]!) ? inflateSync(raw).toString('latin1') : raw.toString('latin1');
        out.push({dict: m[1]!, data});
    }
    return out;
}

function box(text: string, name: string): number[] | null {
    const m = new RegExp(`/${name} \\[([-\\d.\\s]+)\\]`).exec(text);
    return m ? m[1]!.trim().split(/\s+/).map(Number) : null;
}

type Matrix = [number, number, number, number, number, number];
const multiply = (m: Matrix, n: Matrix): Matrix => [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
];

/** Straight segments of every stroked path, in page space (pt). */
function strokedSegments(content: string): [number, number, number, number][] {
    const tokens = content.match(/\/[^\s/[\]()<>]+|-?\d*\.?\d+(?:e-?\d+)?|[A-Za-z*'"]+|\[|\]/g) ?? [];
    let ctm: Matrix = [1, 0, 0, 1, 0, 0];
    const stack: Matrix[] = [];
    const nums: number[] = [];
    let path: [number, number, number, number][] = [];
    let current: [number, number] | null = null;
    const toPage = (x: number, y: number): [number, number] => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
    const segments: [number, number, number, number][] = [];
    for (const t of tokens) {
        if (/^-?\d*\.?\d+(?:e-?\d+)?$/.test(t)) {
            nums.push(Number(t));
            continue;
        }
        const args = nums.splice(0);
        switch (t) {
            case 'q':
                stack.push(ctm);
                break;
            case 'Q':
                ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
                break;
            case 'cm':
                ctm = multiply(args as Matrix, ctm);
                break;
            case 'm':
                current = toPage(args[0]!, args[1]!);
                break;
            case 'l': {
                const next = toPage(args[0]!, args[1]!);
                if (current) {
                    path.push([current[0], current[1], next[0], next[1]]);
                }
                current = next;
                break;
            }
            case 'S':
            case 's':
                segments.push(...path);
                path = [];
                break;
            case 'f':
            case 'F':
            case 'f*':
            case 'B':
            case 'B*':
            case 'b':
            case 'b*':
            case 'n':
                path = [];
                break;
        }
    }
    return segments;
}

const CASES: {size: ShopSizeChoice; label: string}[] = [
    {size: {id: 'a3', unit: 'mm'}, label: 'A3'},
    {size: {id: '24x36in', unit: 'in'}, label: '24 × 36 in'},
    {size: {id: '36x48in', unit: 'in'}, label: '36 × 48 in'},
];
const OPTION_SETS: {name: string; options: ShopPrintOptions}[] = [
    {name: 'standard bleed', options: {bleed: 'std', cropMarks: false, colour: 'colour'}},
    {name: 'exact trim', options: {bleed: {mm: 0}, cropMarks: false, colour: 'colour'}},
    {name: '10 mm bleed', options: {bleed: {mm: 10}, cropMarks: false, colour: 'colour'}},
    {name: 'standard bleed + crop marks', options: {bleed: 'std', cropMarks: true, colour: 'colour'}},
];

const server = await createServer({
    configFile: false,
    root: path.join(ROOT, 'scripts/shop-pdf-harness'),
    publicDir: path.join(ROOT, 'public'),
    logLevel: 'error',
    server: {port: 0, strictPort: false, fs: {allow: [ROOT]}},
});
await server.listen();
const url = server.resolvedUrls?.local[0];
const browser = await chromium.launch({channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome'});
let pdfs = 0;
try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => failures.push(`harness page error: ${e.message}`));
    await page.goto(url!);
    await page.waitForFunction(() => document.title === 'ready', null, {timeout: 60_000});

    for (const {size, label: sizeLabel} of CASES) {
        const [squaresX, squaresY] = [7, 5];
        const squareMm = maxShopSquareMm(squaresX, squaresY, size.id)!;
        for (const {name, options} of OPTION_SETS) {
            const label = `${sizeLabel}, ${name}`;
            const built = (await page.evaluate(
                (r) => (window as unknown as {buildShopPdf: (r: unknown) => Promise<unknown>}).buildShopPdf(r),
                {squaresX, squaresY, squareMm, size, options},
            )) as Built;
            const pdf = Buffer.from(built.pdf, 'base64');
            const text = pdf.toString('latin1');
            const streams = pdfStreams(pdf);
            const pageDicts = text.match(/\/Type \/Page(?!s)/g) ?? [];
            if (pageDicts.length !== 1) {
                failures.push(`${label}: ${pageDicts.length} pages, expected 1`);
            }

            const b = bleedMmForUnit(options.bleed, size.unit);
            const media = box(text, 'MediaBox');
            const trim = box(text, 'TrimBox');
            const bleed = box(text, 'BleedBox');
            const expectBox = (bx: {x: number; y: number; w: number; h: number}) => [
                bx.x * PT,
                (built.mediaMm.h - bx.y - bx.h) * PT,
                (bx.x + bx.w) * PT,
                (built.mediaMm.h - bx.y) * PT,
            ];
            const close = (got: number[] | null, want: number[]) => got !== null && got.length === 4 && got.every((v, i) => Math.abs(v - want[i]!) <= TOL_PT);
            const wantMedia = [0, 0, built.mediaMm.w * PT, built.mediaMm.h * PT];
            if (!close(media, wantMedia) || !close(trim, expectBox(built.trimBoxMm)) || !close(bleed, expectBox(built.bleedBoxMm))) {
                failures.push(`${label}: boxes Media ${media} Trim ${trim} Bleed ${bleed} are not as computed`);
            }
            if (!options.cropMarks && !close(media, bleed ?? [])) {
                failures.push(`${label}: MediaBox is not the BleedBox without crop marks`);
            }
            if (b === 0 && !options.cropMarks && !close(trim, bleed ?? [])) {
                failures.push(`${label}: TrimBox is not the BleedBox at exact trim`);
            }
            if (options.cropMarks && !(media && bleed && [bleed[0]! - media[0]!, bleed[1]! - media[1]!, media[2]! - bleed[2]!, media[3]! - bleed[3]!].every((d) => Math.abs(d - 7 * PT) <= TOL_PT))) {
                failures.push(`${label}: MediaBox is not the BleedBox + 7 mm a side with crop marks`);
            }

            if (/\/Type \/Font|\/FontFile|\/Subtype \/Image|\/ExtGState/.test(text)) {
                failures.push(`${label}: PDF has a font, image or ExtGState`);
            }
            const content = streams.map((s) => s.data).join('\n');
            if (/(^|\s)(BT|Tf|Tj|TJ)(\s|$)/m.test(content)) {
                failures.push(`${label}: PDF has text operators`);
            }
            if (!/\/PrintScaling \/None/.test(text)) {
                failures.push(`${label}: no /PrintScaling /None`);
            }
            // jsPDF writes zero as `0` or `0.`.
            const zero = String.raw`0(?:\.0*)?`;
            if (new RegExp(String.raw`(^|\s)${zero} ${zero} ${zero} (rg|RG)(\s|$)`, 'm').test(content) || !new RegExp(String.raw`(^|\s)${zero} g(\s|$)`, 'm').test(content)) {
                failures.push(`${label}: black is not DeviceGray 0 g`);
            }

            // Crop marks: stroked segments outside the trim, each on a trim edge line, b to b + 6 mm out.
            if (trim) {
                const [tx0, ty0, tx1, ty1] = trim as [number, number, number, number];
                const outside = strokedSegments(content).filter(([x0, y0, x1, y1]) => Math.max(x0, x1) < tx0 - TOL_PT || Math.min(x0, x1) > tx1 + TOL_PT || Math.max(y0, y1) < ty0 - TOL_PT || Math.min(y0, y1) > ty1 + TOL_PT);
                const near = b * PT;
                const far = (b + SHOP_CROP_MARK_LENGTH_MM) * PT;
                const within = (v: number, a: number) => Math.abs(v - a) <= TOL_PT;
                const isMark = ([x0, y0, x1, y1]: [number, number, number, number]) => {
                    if (within(y0, y1) && (within(y0, ty0) || within(y0, ty1))) {
                        const [a, z] = [Math.min(x0, x1), Math.max(x0, x1)];
                        return (within(a, tx0 - far) && within(z, tx0 - near)) || (within(a, tx1 + near) && within(z, tx1 + far));
                    }
                    if (within(x0, x1) && (within(x0, tx0) || within(x0, tx1))) {
                        const [a, z] = [Math.min(y0, y1), Math.max(y0, y1)];
                        return (within(a, ty0 - far) && within(z, ty0 - near)) || (within(a, ty1 + near) && within(z, ty1 + far));
                    }
                    return false;
                };
                const marks = outside.filter(isMark);
                if (options.cropMarks ? marks.length !== 8 || outside.length !== 8 : outside.length !== 0) {
                    failures.push(`${label}: ${marks.length} crop marks at b..b + 6 mm, ${outside.length} strokes outside the trim`);
                }
            }

            const keywords = /\/Keywords \(([^)]*)\)/.exec(text)?.[1] ?? '';
            const link = keywords.match(/https?:\/\/\S+/)?.[0];
            const back = link ? parseCharucoQrSearchParams(new URL(link).searchParams) : null;
            if (!back || link !== built.chartUrl || back.squaresX !== squaresX || back.squaresY !== squaresY || back.squareLengthMm !== squareMm || back.shopSize?.id !== size.id || back.shopOptions?.cropMarks !== options.cropMarks) {
                failures.push(`${label}: the chart link in the PDF (${link}) does not reopen the board`);
            }
            pdfs++;
        }
    }
} finally {
    await browser.close();
    await server.close();
}

if (failures.length > 0) {
    console.error(`\nPrint-shop PDF check failed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
}
console.log(`check:shop-pdf: ${pdfs} PDFs OK (one font-free page, boxes, crop marks at b..b + 6 mm, link)`);
