import {CHARUCO_PRINT_LABEL_SPEC_VERSION, OPENCV_LABEL_VERSION} from './constants.js';

function charucoCv2QueryValue(markerLengthRatio: number): string {
    return `${OPENCV_LABEL_VERSION}+DICT_4X4_250+ratio=${markerLengthRatio}`;
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
