import {APP_VERSION} from '../appVersion.js';
import {CHARUCO_MARKER_LENGTH_RATIO, OPENCV_LABEL_VERSION} from './constants.js';
import {parseChartVersion, type ChartVersion} from './chartVersion.js';

export function charucoCv2QueryValue(markerLengthRatio: number): string {
    return `${OPENCV_LABEL_VERSION}+DICT_4X4_250+ratio=${markerLengthRatio}`;
}

/** OpenCV / dictionary / ratio metadata embedded in legacy chart QR links (for round‑trip checks). */
export function expectedCharucoCv2QueryValue(
    markerLengthRatio: number = CHARUCO_MARKER_LENGTH_RATIO,
): string {
    return charucoCv2QueryValue(markerLengthRatio);
}

/** Link format a query matched: packed `b` is current, separate params are legacy. */
export type CharucoQrQueryFormat = 'packed' | 'legacy';

/** "My printer" (tiled sheets, `p` field) or "Print shop" (one trimmed board, `t` field). */
export type PrintMode = 'home' | 'shop';

/** The print-shop mm | in toggle. */
export type ShopUnit = 'mm' | 'in';

/**
 * Standard print-shop sizes by their link code: the index is the code in the `t` field. Fixed forever
 * once v2 is published: printed boards carry these codes, so never renumber or reuse; append new sizes.
 */
export const SHOP_SIZE_LINK_CODES = [
    '18x24in',
    '24x36in',
    '36x48in',
    'a2',
    'a1',
    'a0',
    '12x18in',
    '16x20in',
    'a3',
    'b1',
    '450x600mm',
    '600x900mm',
    '900x1200mm',
] as const;

export type ShopSizeId = (typeof SHOP_SIZE_LINK_CODES)[number];

/** The unit a standard size is sold in; the link names the toggle's unit only when it differs. */
export function shopSizeNativeUnit(id: ShopSizeId): ShopUnit {
    return id.endsWith('in') ? 'in' : 'mm';
}

/** A print-shop trim choice. Every variant carries the toggle's unit, so it round-trips in the link. */
export type ShopSizeChoice =
    | {kind: 'fit'; unit: ShopUnit}
    | {kind: 'std'; id: ShopSizeId; unit: ShopUnit}
    /** Custom trim in mm: whole mm with the mm toggle, ¼ in steps with the in toggle. */
    | {kind: 'custom'; wMm: number; hMm: number; unit: ShopUnit};

export interface ShopPrintOptions {
    /** `'std'` follows the unit (3 mm or ⅛ in); otherwise a fixed bleed in mm (0 = exact trim). */
    bleed: 'std' | {mm: number};
    cropMarks: boolean;
    colour: 'colour' | 'mono';
}

export const SHOP_DEFAULT_OPTIONS: Readonly<ShopPrintOptions> = {bleed: 'std', cropMarks: false, colour: 'colour'};

/** Largest bleed a link may carry (mm). */
export const SHOP_BLEED_MAX_MM = 25;

/** Standard bleed for the toggle's unit: 3 mm, or ⅛ in. */
export function shopStandardBleedMm(unit: ShopUnit): number {
    return unit === 'in' ? 25.4 / 8 : 3;
}

/** A shop board's link target, or a home paper id (`null` for a paper without a code). */
export type LinkTarget =
    | {kind: 'home'; paperId: string | null}
    | {kind: 'shop'; size: ShopSizeChoice; options: ShopPrintOptions};

export interface ParsedCharucoQrQuery {
    /** Which of the two parsing paths produced these values. */
    format: CharucoQrQueryFormat;
    /** Raw version token from the packed `b` param or legacy `v` param. */
    chartVersionRaw: string | null;
    /** Parsed version; legacy `v=1` becomes 1.0.0. Null when absent or unparseable. */
    chartVersion: ChartVersion | null;
    squaresX: number | null;
    squaresY: number | null;
    squareLengthMm: number | null;
    /** Paper preset id from the packed `p` code; null for older links and the legacy format. */
    paperId: string | null;
    /** `shop` when the packed value has a `t` field; it wins over `p`. */
    printMode: PrintMode;
    /** The shop trim; null in home mode, or when the size was unreadable (open at Fit). */
    shopSize: ShopSizeChoice | null;
    /** The shop print-file options; null in home mode, the defaults when they were unreadable. */
    shopOptions: ShopPrintOptions | null;
    /** The `t` size was unknown or malformed (e.g. a code from a newer table). */
    shopSizeError: boolean;
    /** The `t` options were malformed or out of range; the size was kept. */
    shopOptionsError: boolean;
    /** Legacy OpenCV metadata; current charts do not write it. */
    cv2: string | null;
}

/**
 * `develop` is the fixed token dev servers stamp (see `DEV_APP_VERSION` in `vite.config.ts`).
 * It has no numeric core, so `parseChartVersion` returns null for it — but the board
 * parameters still round-trip.
 */
const PACKED_CHART_RE =
    /^(develop|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)w(\d+)h(\d+)s(\d+(?:\.\d+)?)(?:p(\d))?(?:t(.*))?$/;

/**
 * The `t` tail is parsed in stages so a damaged size never loses the board and damaged options never
 * lose the size. Size forms use only digits, `.`, `x`, `m` and `i`, so the tail splits at the first
 * option letter; a new option letter must also join this class.
 */
const SHOP_TAIL_SPLIT_RE = /^([^bceg]*)(.*)$/;

/** Fit (`m` | `i`), a standard size code with an optional toggle unit, or a custom mm / ¼ in trim. */
const SHOP_SIZE_RE =
    /^(?:([mi])|(0|[1-9]\d?)([mi])?|([1-9]\d{0,3})x([1-9]\d{0,3})m|([1-9]\d{0,2}(?:\.(?:25|5|75))?)x([1-9]\d{0,2}(?:\.(?:25|5|75))?)i)$/;

/** No bleed (`e`) or a bleed in mm, then crop marks, then monochrome; the defaults write nothing. */
const SHOP_OPTIONS_RE = /^(?:(e)|b(\d{1,2}(?:\.\d{1,3})?))?(c)?(g)?$/;

const unitFromLetter = (letter: string): ShopUnit => (letter === 'i' ? 'in' : 'mm');
const unitLetter = (unit: ShopUnit): string => (unit === 'in' ? 'i' : 'm');

/** Numbers in their shortest form (`24.5`, `6.35`, `3.175`), at most three decimals. */
function shortNumber(n: number): string {
    return String(Number(n.toFixed(3)));
}

function parseShopSize(raw: string): ShopSizeChoice | null {
    const m = SHOP_SIZE_RE.exec(raw);
    if (!m) {
        return null;
    }
    if (m[1] !== undefined) {
        return {kind: 'fit', unit: unitFromLetter(m[1])};
    }
    if (m[2] !== undefined) {
        const id = SHOP_SIZE_LINK_CODES[Number(m[2])];
        if (id === undefined) {
            return null;
        }
        return {kind: 'std', id, unit: m[3] === undefined ? shopSizeNativeUnit(id) : unitFromLetter(m[3])};
    }
    if (m[4] !== undefined) {
        return {kind: 'custom', wMm: Number(m[4]), hMm: Number(m[5]), unit: 'mm'};
    }
    return {kind: 'custom', wMm: Number(m[6]) * 25.4, hMm: Number(m[7]) * 25.4, unit: 'in'};
}

function parseShopOptions(raw: string): ShopPrintOptions | null {
    const m = SHOP_OPTIONS_RE.exec(raw);
    if (!m) {
        return null;
    }
    let bleed: ShopPrintOptions['bleed'] = 'std';
    if (m[1] !== undefined) {
        bleed = {mm: 0};
    } else if (m[2] !== undefined) {
        const mm = Number(m[2]);
        if (mm > SHOP_BLEED_MAX_MM) {
            return null;
        }
        bleed = {mm};
    }
    return {bleed, cropMarks: m[3] !== undefined, colour: m[4] !== undefined ? 'mono' : 'colour'};
}

type ShopLinkValues = Pick<
    ParsedCharucoQrQuery,
    'printMode' | 'shopSize' | 'shopOptions' | 'shopSizeError' | 'shopOptionsError'
>;

const HOME_LINK_VALUES: ShopLinkValues = {
    printMode: 'home',
    shopSize: null,
    shopOptions: null,
    shopSizeError: false,
    shopOptionsError: false,
};

function parseShopTail(tail: string | undefined): ShopLinkValues {
    if (tail === undefined) {
        return HOME_LINK_VALUES;
    }
    const [, sizeRaw, optionsRaw] = SHOP_TAIL_SPLIT_RE.exec(tail)!;
    const shopSize = parseShopSize(sizeRaw!);
    const options = parseShopOptions(optionsRaw!);
    return {
        printMode: 'shop',
        shopSize,
        shopOptions: options ?? {...SHOP_DEFAULT_OPTIONS},
        shopSizeError: shopSize === null,
        shopOptionsError: options === null,
    };
}

function shopSizeLinkValue(size: ShopSizeChoice): string {
    if (size.kind === 'fit') {
        return unitLetter(size.unit);
    }
    if (size.kind === 'std') {
        const code = SHOP_SIZE_LINK_CODES.indexOf(size.id);
        return `${code}${size.unit === shopSizeNativeUnit(size.id) ? '' : unitLetter(size.unit)}`;
    }
    if (size.unit === 'in') {
        const quarterIn = (mm: number) => shortNumber(Math.round((mm / 25.4) * 4) / 4);
        return `${quarterIn(size.wMm)}x${quarterIn(size.hMm)}i`;
    }
    return `${Math.round(size.wMm)}x${Math.round(size.hMm)}m`;
}

function shopOptionsLinkValue(options: ShopPrintOptions, unit: ShopUnit): string {
    let bleed = '';
    if (options.bleed !== 'std') {
        const {mm} = options.bleed;
        if (mm === 0) {
            bleed = 'e';
        } else if (Math.abs(mm - shopStandardBleedMm(unit)) > 1e-9) {
            bleed = `b${shortNumber(mm)}`;
        }
    }
    return `${bleed}${options.cropMarks ? 'c' : ''}${options.colour === 'mono' ? 'g' : ''}`;
}

/**
 * One-digit paper codes for the packed `p` field (two characters in the link). Fixed forever:
 * printed charts carry them, so never renumber; append new papers with new digits.
 */
const PAPER_LINK_CODES: Readonly<Record<string, number>> = {a4: 0, a3: 1, letter: 2, tabloid: 3};

function paperIdFromLinkCode(code: string | undefined): string | null {
    if (code === undefined) {
        return null;
    }
    const n = Number(code);
    return Object.keys(PAPER_LINK_CODES).find((id) => PAPER_LINK_CODES[id] === n) ?? null;
}

type PackedChartValues = Pick<
    ParsedCharucoQrQuery,
    'chartVersionRaw' | 'chartVersion' | 'squaresX' | 'squaresY' | 'squareLengthMm' | 'paperId'
> &
    ShopLinkValues;

function parsePackedChartQueryValue(raw: string): PackedChartValues | null {
    const m = PACKED_CHART_RE.exec(raw);
    if (!m) {
        return null;
    }
    const versionRaw = m[1]!;
    return {
        chartVersionRaw: versionRaw,
        chartVersion: parseChartVersion(versionRaw),
        squaresX: Number(m[2]),
        squaresY: Number(m[3]),
        squareLengthMm: Number(m[4]),
        paperId: paperIdFromLinkCode(m[5]),
        ...parseShopTail(m[6]),
    };
}

/**
 * Current format: one packed `b` param, e.g. `b=2.0.1w12h9s50p0` (`p` = paper code, optional) or
 * `b=2.0.1w12h9s50t1c` (`t` = print-shop trim and options).
 * Returns `null` when `b` is absent or does not match the packed grammar, so the
 * caller can decide whether to fall back to legacy params.
 */
export function parsePackedCharucoQrQuery(
    searchParams: URLSearchParams,
): ParsedCharucoQrQuery | null {
    const bRaw = searchParams.get('b');
    if (bRaw === null || bRaw === '') {
        return null;
    }
    const packed = parsePackedChartQueryValue(bRaw);
    if (!packed) {
        return null;
    }
    return {format: 'packed', ...packed, cv2: null};
}

/**
 * Legacy format: separate `v`, `w`, `h`, `s` params, plus `cv2` OpenCV metadata.
 * Missing or unparseable values become `null`; this never rejects the whole query.
 */
export function parseLegacyCharucoQrQuery(searchParams: URLSearchParams): ParsedCharucoQrQuery {
    const parseIntNullable = (key: string): number | null => {
        const raw = searchParams.get(key);
        if (raw === null || raw === '') {
            return null;
        }
        const n = Number(raw);
        if (!Number.isFinite(n)) {
            return null;
        }
        return Math.trunc(n);
    };

    const parseFloatNullable = (key: string): number | null => {
        const raw = searchParams.get(key);
        if (raw === null || raw === '') {
            return null;
        }
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
    };

    const vRaw = searchParams.get('v');
    const chartVersionRaw = vRaw === null || vRaw.trim() === '' ? null : vRaw.trim();
    const cv2Raw = searchParams.get('cv2');

    return {
        format: 'legacy',
        chartVersionRaw,
        chartVersion: chartVersionRaw === null ? null : parseChartVersion(chartVersionRaw),
        squaresX: parseIntNullable('w'),
        squaresY: parseIntNullable('h'),
        squareLengthMm: parseFloatNullable('s'),
        paperId: null,
        ...HOME_LINK_VALUES,
        cv2: cv2Raw === null || cv2Raw === '' ? null : cv2Raw,
    };
}

/**
 * Read query args from chart QR URLs built by `buildCharucoDocumentationUrl`.
 *
 * Dispatch: a valid packed `b` param means the current format and wins outright.
 * Otherwise (including a malformed `b`) the legacy separate params are read, so
 * old links keep working. {@link ParsedCharucoQrQuery.format} reports the path taken.
 */
export function parseCharucoQrSearchParams(searchParams: URLSearchParams): ParsedCharucoQrQuery {
    return parsePackedCharucoQrQuery(searchParams) ?? parseLegacyCharucoQrQuery(searchParams);
}

/** Query keys written by chart QR / shareable URLs (removed before re-writing). */
const CHART_QR_PARAM_KEYS = ['v', 'w', 'h', 's', 'cv2', 'b'] as const;

function linkTargetOf(target: string | null | LinkTarget): LinkTarget {
    return target === null || typeof target === 'string' ? {kind: 'home', paperId: target} : target;
}

/**
 * Compact chart spec: `<version>w<squaresX>h<squaresY>s<squareLengthMm>`, then `p<paperCode>` for a
 * home paper (omitted for a paper without a code) or `t<size>[<options>]` for a print-shop board
 * (e.g. `2.0.1w12h9s50p0`, `2.0.1w12h9s50t1c`). A paper id or `null` means a home paper.
 */
export function packedChartQueryValue(
    version: string,
    squaresX: number,
    squaresY: number,
    squareLengthMm: number,
    target: string | null | LinkTarget = null,
): string {
    const core = `${version}w${squaresX}h${squaresY}s${squareLengthMm}`;
    const t = linkTargetOf(target);
    if (t.kind === 'shop') {
        return `${core}t${shopSizeLinkValue(t.size)}${shopOptionsLinkValue(t.options, t.size.unit)}`;
    }
    const code = t.paperId === null ? undefined : PAPER_LINK_CODES[t.paperId];
    return `${core}${code === undefined ? '' : `p${code}`}`;
}

/**
 * Rewrite chart QR query parameters on {@link searchParams} (drops prior values for those keys
 * then sets the current packed value). Other keys are untouched so tracking params can coexist.
 */
export function mergeCharucoQrParamsInto(
    searchParams: URLSearchParams,
    squaresX: number,
    squaresY: number,
    squareLengthMm: number,
    target: string | null | LinkTarget,
    version: string = APP_VERSION,
): void {
    for (const k of CHART_QR_PARAM_KEYS) {
        searchParams.delete(k);
    }
    searchParams.set('b', packedChartQueryValue(version, squaresX, squaresY, squareLengthMm, target));
}

export function buildCharucoDocumentationUrl(
    sourceUrl: string,
    squaresX: number,
    squaresY: number,
    squareLengthMm: number,
    target: string | null | LinkTarget,
    version: string = APP_VERSION,
): string {
    const u = new URL(sourceUrl);
    mergeCharucoQrParamsInto(u.searchParams, squaresX, squaresY, squareLengthMm, target, version);
    return u.toString();
}
