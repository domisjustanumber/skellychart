import {generateImageMarker} from './aruco.js';

export interface CharucoGeometry {
    squaresX: number;
    squaresY: number;
    squareLength: number;
    markerLength: number;
    legacyPattern: boolean;
}

export interface CharucoMarkerModel {
    id: number;
    /** Axis-aligned corners in board plane (mm); OpenCV order: TL, TR, BR, BL. */
    cornersMm: [{x: number; y: number}, {x: number; y: number}, {x: number; y: number}, {x: number; y: number}];
}

/** Marker layout matching `CharucoBoardImpl::createCharucoBoard` (OpenCV ≥4.6 non-legacy by default). */
export function buildCharucoMarkers(geom: CharucoGeometry): CharucoMarkerModel[] {
    const {squaresX, squaresY, squareLength, markerLength, legacyPattern} = geom;
    const diff = (squareLength - markerLength) / 2;
    const markers: CharucoMarkerModel[] = [];
    let nextId = 0;
    for (let y = 0; y < squaresY; y++) {
        for (let x = 0; x < squaresX; x++) {
            const skip =
                legacyPattern && squaresY % 2 === 0
                    ? (y + 1) % 2 === x % 2
                    : y % 2 === x % 2;
            if (skip) {
                continue;
            }
            const x0 = x * squareLength + diff;
            const y0 = y * squareLength + diff;
            markers.push({
                id: nextId++,
                cornersMm: [
                    {x: x0, y: y0},
                    {x: x0 + markerLength, y: y0},
                    {x: x0 + markerLength, y: y0 + markerLength},
                    {x: x0, y: y0 + markerLength},
                ],
            });
        }
    }
    return markers;
}

function blitGray(
    dest: Uint8Array,
    destW: number,
    dx: number,
    dy: number,
    src: Uint8Array,
    sw: number,
    sh: number,
): void {
    for (let j = 0; j < sh; j++) {
        const y = dy + j;
        if (y < 0) {
            continue;
        }
        const rowOff = y * destW;
        for (let i = 0; i < sw; i++) {
            const x = dx + i;
            if (x < 0 || x >= destW) {
                continue;
            }
            dest[rowOff + x] = src[j * sw + i]!;
        }
    }
}

/** OpenCV `CharucoBoardImpl::generateImage` + `Board::Impl::generateImage` (aligned blit path). */
export function renderCharucoBoardGray(widthPx: number, heightPx: number, geom: CharucoGeometry): Uint8Array {
    const {squaresX: w, squaresY: h, squareLength, markerLength, legacyPattern} = geom;
    const img = new Uint8Array(widthPx * heightPx);
    img.fill(255);

    let pixInSquareX = widthPx / w;
    let pixInSquareY = heightPx / h;
    let pixInSquare: number;
    let startX = 0;
    let startY = 0;
    let pixBoardW = widthPx;
    let pixBoardH = heightPx;
    if (pixInSquareX <= pixInSquareY) {
        pixInSquare = pixInSquareX;
        pixBoardH = Math.round(pixInSquare * h);
        startY = Math.floor((heightPx - pixBoardH) / 2);
    } else {
        pixInSquare = pixInSquareY;
        pixBoardW = Math.round(pixInSquare * w);
        startX = Math.floor((widthPx - pixBoardW) / 2);
    }

    const pixInMarker = (markerLength / squareLength) * pixInSquare;
    const pixInMarginMarker = 0.5 * (pixInSquare - pixInMarker);
    const endArucoX = Math.round(pixInSquare * (w - 1) + pixInMarginMarker + pixInMarker);
    const endArucoY = Math.round(pixInSquare * (h - 1) + pixInMarginMarker + pixInMarker);
    const arucoX0 = Math.round(pixInMarginMarker);
    const arucoY0 = Math.round(pixInMarginMarker);
    const arucoW = endArucoX - arucoX0;
    const arucoH = endArucoY - arucoY0;

    const markers = buildCharucoMarkers(geom);
    let minX = markers[0]!.cornersMm[0]!.x;
    let maxX = markers[0]!.cornersMm[0]!.x;
    let minY = markers[0]!.cornersMm[0]!.y;
    let maxY = markers[0]!.cornersMm[0]!.y;
    for (const m of markers) {
        for (const c of m.cornersMm) {
            minX = Math.min(minX, c.x);
            maxX = Math.max(maxX, c.x);
            minY = Math.min(minY, c.y);
            maxY = Math.max(maxY, c.y);
        }
    }
    const sizeX = maxX - minX;
    const sizeY = maxY - minY;

    const zoneOffX = startX + arucoX0;
    const zoneOffY = startY + arucoY0;

    for (const m of markers) {
        const oc0 = m.cornersMm[0]!;
        const oc2 = m.cornersMm[2]!;
        const p0 = {x: ((oc0.x - minX) / sizeX) * arucoW, y: ((oc0.y - minY) / sizeY) * arucoH};
        const p2 = {x: ((oc2.x - minX) / sizeX) * arucoW, y: ((oc2.y - minY) / sizeY) * arucoH};
        let dstW = Math.round(p2.x - p0.x);
        let dstH = Math.round(p2.y - p0.y);
        const side = Math.min(dstW, dstH);
        if (side < 6) {
            continue;
        }
        const markerGray = generateImageMarker(m.id, side, 1);
        const dx = zoneOffX + Math.round(p0.x);
        const dy = zoneOffY + Math.round(p0.y);
        blitGray(img, widthPx, dx, dy, markerGray, side, side);
    }

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const isBlack =
                legacyPattern && h % 2 === 0 ? (y + 1) % 2 === x % 2 : y % 2 === x % 2;
            if (!isBlack) {
                continue;
            }
            const x0 = Math.round(x * pixInSquare);
            const y0 = Math.round(y * pixInSquare);
            const x1 = Math.round((x + 1) * pixInSquare);
            const y1 = Math.round((y + 1) * pixInSquare);
            for (let yy = y0; yy < y1; yy++) {
                if (yy < 0 || yy >= pixBoardH) {
                    continue;
                }
                const gy = startY + yy;
                if (gy < 0 || gy >= heightPx) {
                    continue;
                }
                const row = gy * widthPx;
                for (let xx = x0; xx < x1; xx++) {
                    if (xx < 0 || xx >= pixBoardW) {
                        continue;
                    }
                    const gx = startX + xx;
                    if (gx >= 0 && gx < widthPx) {
                        img[row + gx] = 0;
                    }
                }
            }
        }
    }

    return img;
}

export function grayToRgba(gray: Uint8Array, width: number, height: number): Uint8ClampedArray {
    const out = new Uint8ClampedArray(width * height * 4);
    let gi = 0;
    let oi = 0;
    for (let i = 0; i < width * height; i++) {
        const g = gray[gi++]!;
        out[oi++] = g;
        out[oi++] = g;
        out[oi++] = g;
        out[oi++] = 255;
    }
    return out;
}

export function putGrayOnCanvas(canvas: HTMLCanvasElement, gray: Uint8Array): void {
    const {width, height} = canvas;
    const ctx = canvas.getContext('2d')!;
    const rgba = grayToRgba(gray, width, height);
    ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
}
