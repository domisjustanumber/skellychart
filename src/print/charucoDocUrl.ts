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
    /** Legacy OpenCV metadata; current charts do not write it. */
    cv2: string | null;
}

/**
 * `develop` is the fixed token dev servers stamp (see `DEV_APP_VERSION` in `vite.config.ts`).
 * It has no numeric core, so `parseChartVersion` returns null for it — but the board
 * parameters still round-trip.
 */
const PACKED_CHART_RE =
    /^(develop|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)w(\d+)h(\d+)s(\d+(?:\.\d+)?)$/;

type PackedChartValues = Pick<
    ParsedCharucoQrQuery,
    'chartVersionRaw' | 'chartVersion' | 'squaresX' | 'squaresY' | 'squareLengthMm'
>;

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
    };
}

/**
 * Current format: one packed `b` param, e.g. `b=1.4.2w12h9s50`.
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

/** Compact chart spec: `<version>w<squaresX>h<squaresY>s<squareLengthMm>` (e.g. `1.4.2w12h9s50`). */
export function packedChartQueryValue(
    version: string,
    squaresX: number,
    squaresY: number,
    squareLengthMm: number,
): string {
    return `${version}w${squaresX}h${squaresY}s${squareLengthMm}`;
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
    version: string = APP_VERSION,
): void {
    for (const k of CHART_QR_PARAM_KEYS) {
        searchParams.delete(k);
    }
    searchParams.set('b', packedChartQueryValue(version, squaresX, squaresY, squareLengthMm));
}

export function buildCharucoDocumentationUrl(
    sourceUrl: string,
    squaresX: number,
    squaresY: number,
    squareLengthMm: number,
    version: string = APP_VERSION,
): string {
    const u = new URL(sourceUrl);
    mergeCharucoQrParamsInto(u.searchParams, squaresX, squaresY, squareLengthMm, version);
    return u.toString();
}
