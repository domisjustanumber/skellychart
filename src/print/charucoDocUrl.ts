import {
    CHARUCO_MARKER_LENGTH_RATIO,
    CHARUCO_PRINT_LABEL_SPEC_VERSION,
    OPENCV_LABEL_VERSION,
} from './constants.js';

export function charucoCv2QueryValue(markerLengthRatio: number): string {
    return `${OPENCV_LABEL_VERSION}+DICT_4X4_250+ratio=${markerLengthRatio}`;
}

/** OpenCV / dictionary / ratio metadata embedded in chart QR links (for round‑trip checks). */
export function expectedCharucoCv2QueryValue(
    markerLengthRatio: number = CHARUCO_MARKER_LENGTH_RATIO,
): string {
    return charucoCv2QueryValue(markerLengthRatio);
}

export interface ParsedCharucoQrQuery {
    labelSpecVersion: number | null;
    squaresX: number | null;
    squaresY: number | null;
    squareLengthMm: number | null;
    cv2: string | null;
}

/** Read query args from chart QR URLs built by `buildCharucoDocumentationUrl`. */
export function parseCharucoQrSearchParams(searchParams: URLSearchParams): ParsedCharucoQrQuery {
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
    let labelSpecVersion: number | null = null;
    if (vRaw !== null && vRaw !== '') {
        const n = Number(vRaw);
        labelSpecVersion = Number.isFinite(n) ? n : null;
    }

    const cv2Raw = searchParams.get('cv2');

    return {
        labelSpecVersion,
        squaresX: parseIntNullable('w'),
        squaresY: parseIntNullable('h'),
        squareLengthMm: parseFloatNullable('s'),
        cv2: cv2Raw === null || cv2Raw === '' ? null : cv2Raw,
    };
}

/** Query keys written by chart QR / shareable URLs (removed before re-writing). */
const CHART_QR_PARAM_KEYS = ['v', 'w', 'h', 's', 'cv2'] as const;

/**
 * Rewrite chart QR query parameters on {@link searchParams} (drops prior values for those keys
 * then sets fresh ones). Other keys are untouched so tracking params can coexist.
 */
export function mergeCharucoQrParamsInto(
    searchParams: URLSearchParams,
    squaresX: number,
    squaresY: number,
    squareLengthMm: number,
    markerLengthRatio: number,
): void {
    for (const k of CHART_QR_PARAM_KEYS) {
        searchParams.delete(k);
    }
    searchParams.set('v', String(CHARUCO_PRINT_LABEL_SPEC_VERSION));
    searchParams.set('w', String(squaresX));
    searchParams.set('h', String(squaresY));
    searchParams.set('s', String(squareLengthMm));
    searchParams.set('cv2', charucoCv2QueryValue(markerLengthRatio));
}

export function buildCharucoDocumentationUrl(
    sourceUrl: string,
    squaresX: number,
    squaresY: number,
    squareLengthMm: number,
    markerLengthRatio: number,
): string {
    const u = new URL(sourceUrl);
    mergeCharucoQrParamsInto(u.searchParams, squaresX, squaresY, squareLengthMm, markerLengthRatio);
    return u.toString();
}
