/**
 * Build guard for the chart link grammar (`src/print/charucoDocUrl.ts`): a golden table of links every
 * generator has printed (legacy params, 1.x, 2.x home `p` and print-shop `t`) with what they must open
 * as, garbled links that must degrade without losing the board, the writer → parser round trip for
 * every shop size form × bleed × marks × colour × unit, and the QR version of the longest links.
 */
import QRCode from 'qrcode';
import {
    buildCharucoDocumentationUrl,
    packedChartQueryValue,
    parseCharucoQrSearchParams,
    SHOP_SIZE_LINK_CODES,
    shopSizeNativeUnit,
    shopStandardBleedMm,
    type ParsedCharucoQrQuery,
    type ShopPrintOptions,
    type ShopSizeChoice,
    type ShopUnit,
} from '../src/print/charucoDocUrl.js';

const SOURCE_URL = 'https://skelly.cam/c/';
const failures: string[] = [];
let checks = 0;

function parse(query: string): ParsedCharucoQrQuery {
    return parseCharucoQrSearchParams(new URLSearchParams(query));
}

/** Rounds mm to 1 µm so ¼ in sizes and bleeds compare exactly. */
function canon(value: unknown): unknown {
    if (typeof value === 'number') {
        return Math.round(value * 1000) / 1000;
    }
    if (Array.isArray(value)) {
        return value.map(canon);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, canon(v)]));
    }
    return value;
}

function expect(query: string, wanted: Partial<ParsedCharucoQrQuery>): void {
    const got = parse(query);
    for (const [key, value] of Object.entries(wanted)) {
        const actual = JSON.stringify(canon(got[key as keyof ParsedCharucoQrQuery]));
        const expected = JSON.stringify(canon(value));
        if (actual !== expected) {
            failures.push(`${query}: ${key} is ${actual}, expected ${expected}`);
        }
    }
    checks++;
}

const board = {squaresX: 12, squaresY: 9, squareLengthMm: 50};
const home = {printMode: 'home', shopSize: null, shopOptions: null, shopSizeError: false, shopOptionsError: false} as const;
const DEFAULTS: ShopPrintOptions = {bleed: 'std', cropMarks: false, colour: 'colour'};
const shop = (shopSize: ShopSizeChoice | null, shopOptions: ShopPrintOptions = DEFAULTS) => ({
    ...board,
    printMode: 'shop' as const,
    shopSize,
    shopOptions,
    shopSizeError: shopSize === null,
    shopOptionsError: false,
});

// Legacy separate params and 1.x / 2.x home links.
expect('v=1&w=7&h=5&s=26&cv2=4.10.0%2BDICT_4X4_250%2Bratio%3D0.8', {format: 'legacy', squaresX: 7, squaresY: 5, squareLengthMm: 26, paperId: null, ...home});
expect('b=1.2.0w12h9s50', {format: 'packed', ...board, paperId: null, ...home});
for (const [code, paperId] of [['0', 'a4'], ['1', 'a3'], ['2', 'letter'], ['3', 'tabloid']] as const) {
    expect(`b=2.0.0w12h9s50p${code}`, {format: 'packed', ...board, paperId, ...home});
}
for (const version of ['develop', '0.0.0-dev', '2.1.0-rc.1']) {
    expect(`b=${version}w12h9s50p0`, {chartVersionRaw: version, ...board, paperId: 'a4', ...home});
}
for (const code of [4, 5, 6, 7, 8, 9]) {
    expect(`b=2.0.0w12h9s50p${code}`, {format: 'packed', ...board, paperId: null, ...home});
}
expect('b=2.0.0w12h9s50.5p0', {squareLengthMm: 50.5, paperId: 'a4'});

// Print-shop sizes: Fit, every standard code with and without a toggle unit, custom extremes.
expect('b=2.0.0w12h9s50tm', shop({kind: 'fit', unit: 'mm'}));
expect('b=2.0.0w12h9s50ti', shop({kind: 'fit', unit: 'in'}));
SHOP_SIZE_LINK_CODES.forEach((id, code) => {
    const native = shopSizeNativeUnit(id);
    expect(`b=2.0.0w12h9s50t${code}`, shop({kind: 'std', id, unit: native}));
    expect(`b=2.0.0w12h9s50t${code}m`, shop({kind: 'std', id, unit: 'mm'}));
    expect(`b=2.0.0w12h9s50t${code}i`, shop({kind: 'std', id, unit: 'in'}));
});
expect('b=2.0.0w12h9s50t1', shop({kind: 'std', id: '24x36in', unit: 'in'}));
expect('b=2.0.0w12h9s50t4', shop({kind: 'std', id: 'a1', unit: 'mm'}));
expect('b=2.0.0w12h9s50t841x594m', shop({kind: 'custom', wMm: 841, hMm: 594, unit: 'mm'}));
expect('b=2.0.0w12h9s50t1x9999m', shop({kind: 'custom', wMm: 1, hMm: 9999, unit: 'mm'}));
expect('b=2.0.0w9h12s50t24.5x36i', {...shop({kind: 'custom', wMm: 622.3, hMm: 914.4, unit: 'in'}), squaresX: 9, squaresY: 12});
expect('b=2.0.0w12h9s50t0.25x999.75i', {shopSizeError: true});
expect('b=2.0.0w12h9s50t1.25x999.75i', shop({kind: 'custom', wMm: 31.75, hMm: 25393.65, unit: 'in'}));
// `p` and `t` together: `t` decides the mode, `p` still parses.
expect('b=2.0.0w12h9s50p2t1', {...shop({kind: 'std', id: '24x36in', unit: 'in'}), paperId: 'letter'});

// Options on every size form.
const BLEEDS: [string, ShopPrintOptions['bleed']][] = [
    ['', 'std'],
    ['e', {mm: 0}],
    ['b0', {mm: 0}],
    ['b5', {mm: 5}],
    ['b10', {mm: 10}],
    ['b6.35', {mm: 6.35}],
    ['b3.175', {mm: 3.175}],
    ['b3', {mm: 3}],
    ['b25', {mm: 25}],
];
const SIZE_FORMS: [string, ShopSizeChoice][] = [
    ['m', {kind: 'fit', unit: 'mm'}],
    ['i', {kind: 'fit', unit: 'in'}],
    ['1', {kind: 'std', id: '24x36in', unit: 'in'}],
    ['4i', {kind: 'std', id: 'a1', unit: 'in'}],
    ['12', {kind: 'std', id: '900x1200mm', unit: 'mm'}],
    ['841x594m', {kind: 'custom', wMm: 841, hMm: 594, unit: 'mm'}],
    ['24.5x36i', {kind: 'custom', wMm: 622.3, hMm: 914.4, unit: 'in'}],
];
for (const [sizeRaw, size] of SIZE_FORMS) {
    for (const [bleedRaw, bleed] of BLEEDS) {
        for (const cropMarks of [false, true]) {
            for (const mono of [false, true]) {
                const tail = `${sizeRaw}${bleedRaw}${cropMarks ? 'c' : ''}${mono ? 'g' : ''}`;
                expect(`b=2.0.0w12h9s50t${tail}`, shop(size, {bleed, cropMarks, colour: mono ? 'mono' : 'colour'}));
            }
        }
    }
}

// Garbled sizes keep the board and open in shop mode at Fit (size null + flag).
for (const tail of ['', 'x', 'tx', '24x36', '24.1x36i', '13', '17', '99i', '01', '0x10m', '24x36mi', 'mi', '1.5', 'c', 'eg']) {
    expect(`b=2.0.0w12h9s50t${tail}`, {...board, printMode: 'shop', shopSize: null, shopSizeError: true});
}
// Garbled options keep the size and fall back to the defaults.
for (const tail of ['1bx', '1b99', '1b30', '1b25.001', '1gc', '1eb5', '1cc', '1e5', '1b', '1b5.1234', '1ce', 'mbz']) {
    const size = tail.startsWith('m') ? {kind: 'fit', unit: 'mm'} : {kind: 'std', id: '24x36in', unit: 'in'};
    expect(`b=2.0.0w12h9s50t${tail}`, {...board, printMode: 'shop', shopSize: size, shopOptions: DEFAULTS, shopOptionsError: true, shopSizeError: false});
}

// Writer → parser round trip for every size form × bleed in the select × marks × colour × unit.
function effectiveBleedMm(bleed: ShopPrintOptions['bleed'], unit: ShopUnit): number {
    return bleed === 'std' ? shopStandardBleedMm(unit) : bleed.mm;
}
const SELECT_BLEEDS: ShopPrintOptions['bleed'][] = ['std', {mm: 0}, {mm: 5}, {mm: 10}, {mm: 6.35}, {mm: 3}, {mm: 3.175}];
const roundTripSizes: ShopSizeChoice[] = [];
for (const unit of ['mm', 'in'] as const) {
    roundTripSizes.push({kind: 'fit', unit});
    for (const id of SHOP_SIZE_LINK_CODES) {
        roundTripSizes.push({kind: 'std', id, unit});
    }
}
roundTripSizes.push(
    {kind: 'custom', wMm: 841, hMm: 594, unit: 'mm'},
    {kind: 'custom', wMm: 914, hMm: 1219, unit: 'mm'},
    {kind: 'custom', wMm: 101, hMm: 69, unit: 'mm'},
    {kind: 'custom', wMm: 24.5 * 25.4, hMm: 36 * 25.4, unit: 'in'},
    {kind: 'custom', wMm: 35.75 * 25.4, hMm: 47.75 * 25.4, unit: 'in'},
    {kind: 'custom', wMm: 4.25 * 25.4, hMm: 2.75 * 25.4, unit: 'in'},
);
for (const size of roundTripSizes) {
    for (const bleed of SELECT_BLEEDS) {
        for (const cropMarks of [false, true]) {
            for (const colour of ['colour', 'mono'] as const) {
                const options: ShopPrintOptions = {bleed, cropMarks, colour};
                const packed = packedChartQueryValue('2.0.0', 12, 9, 50, {kind: 'shop', size, options});
                const label = `${JSON.stringify(size)} ${JSON.stringify(options)} → ${packed}`;
                const tail = packed.slice(packed.indexOf('t') + 1);
                if (/b0(?![.\d])/.test(tail)) {
                    failures.push(`${label}: writes b0 instead of e`);
                }
                const got = parse(`b=${packed}`);
                const bleedOk =
                    got.shopOptions !== null &&
                    Math.abs(effectiveBleedMm(got.shopOptions.bleed, size.unit) - effectiveBleedMm(bleed, size.unit)) < 1e-9;
                if (
                    got.printMode !== 'shop' ||
                    got.shopSizeError ||
                    got.shopOptionsError ||
                    JSON.stringify(canon(got.shopSize)) !== JSON.stringify(canon(size)) ||
                    !bleedOk ||
                    got.shopOptions?.cropMarks !== cropMarks ||
                    got.shopOptions?.colour !== colour ||
                    got.squaresX !== 12 ||
                    got.squaresY !== 9 ||
                    got.squareLengthMm !== 50
                ) {
                    failures.push(`${label}: parses back as ${JSON.stringify(got)}`);
                }
                // Defaults write nothing: standard bleed (also as its fixed mm value), no marks, colour.
                const isDefault = effectiveBleedMm(bleed, size.unit) === shopStandardBleedMm(size.unit) && !cropMarks && colour === 'colour';
                if (isDefault && /[bceg]/.test(tail)) {
                    failures.push(`${label}: writes options for the defaults`);
                }
                checks++;
            }
        }
    }
}

// Home writer is unchanged: a paper id (or a home target) writes only `p`.
for (const [target, packed] of [
    ['a4', '2.0.0w12h9s50p0'],
    ['tabloid', '2.0.0w12h9s50p3'],
    [null, '2.0.0w12h9s50'],
    [{kind: 'home', paperId: 'letter'}, '2.0.0w12h9s50p2'],
] as const) {
    const got = packedChartQueryValue('2.0.0', 12, 9, 50, target);
    if (got !== packed) {
        failures.push(`home writer for ${JSON.stringify(target)} is ${got}, expected ${packed}`);
    }
    checks++;
}

// QR versions: default links of 42 B or less are version 3; the longest links stay at version 4.
function qrVersion(url: string): number {
    return QRCode.create(url, {errorCorrectionLevel: 'M'}).version;
}
const shopUrl = (version: string, x: number, y: number, s: number, size: ShopSizeChoice, options: ShopPrintOptions = DEFAULTS) =>
    buildCharucoDocumentationUrl(SOURCE_URL, x, y, s, {kind: 'shop', size, options}, version);
const defaultWorst = shopUrl('2.0.0', 10, 8, 100, {kind: 'std', id: '900x1200mm', unit: 'in'});
if (defaultWorst.length !== 42 || qrVersion(defaultWorst) !== 3) {
    failures.push(`${defaultWorst}: ${defaultWorst.length} B, QR version ${qrVersion(defaultWorst)}; expected 42 B at version 3`);
}
const worst = [
    shopUrl('2.0.0', 20, 25, 44, {kind: 'custom', wMm: 35.75 * 25.4, hMm: 47.75 * 25.4, unit: 'in'}, {bleed: {mm: 6.35}, cropMarks: true, colour: 'mono'}),
    shopUrl('2.0.0', 20, 25, 44, {kind: 'custom', wMm: 914, hMm: 1219, unit: 'mm'}, {bleed: {mm: 3.175}, cropMarks: true, colour: 'mono'}),
    shopUrl('2.10.10', 20, 25, 44, {kind: 'custom', wMm: 35.75 * 25.4, hMm: 47.75 * 25.4, unit: 'in'}, {bleed: {mm: 6.35}, cropMarks: true, colour: 'mono'}),
];
for (const url of worst) {
    if (qrVersion(url) > 4) {
        failures.push(`${url}: ${url.length} B needs QR version ${qrVersion(url)}, more than 4`);
    }
    checks++;
}
console.log(`check:links: ${checks} links checked; worst case ${worst[0]!.length} B at QR version ${qrVersion(worst[0]!)}`);

if (failures.length > 0) {
    console.error(`\nLink check failed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
}
