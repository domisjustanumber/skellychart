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

export function buildCharucoDocumentationUrl(
    sourceUrl: string,
    squaresX: number,
    squaresY: number,
    squareLengthMm: number,
    markerLengthRatio: number,
): string {
    const u = new URL(sourceUrl);
    u.searchParams.set('v', String(CHARUCO_PRINT_LABEL_SPEC_VERSION));
    u.searchParams.set('w', String(squaresX));
    u.searchParams.set('h', String(squaresY));
    u.searchParams.set('s', String(squareLengthMm));
    u.searchParams.set('cv2', charucoCv2QueryValue(markerLengthRatio));
    return u.toString();
}
