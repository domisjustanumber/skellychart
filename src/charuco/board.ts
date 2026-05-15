import {ARUCO_MARKER_SIZE_4X4, generateImageMarker, getBitsFromByteList} from './aruco.js';
import {DICT_4X4_250_ROT0_BYTES} from '../skelly-charuco/dict4x4_250_rot0.js';

export interface CharucoGeometry {
    squaresX: number;
    squaresY: number;
    squareLength: number;
    markerLength: number;
}

/**
 * Pixel layout for a ChArUco bitmap (same math as `renderCharucoBoardGray`).
 * Crops for multi-page PDF must use this so page seams never bisect a rendered square
 * (`charuco_board_print.py` splits only on whole square indices; pixel cuts must match).
 */
export function charucoBoardPixelLayout(
    widthPx: number,
    heightPx: number,
    squaresX: number,
    squaresY: number,
): {
    startX: number;
    startY: number;
    pixInSquare: number;
    pixBoardW: number;
    pixBoardH: number;
} {
    const w = squaresX;
    const h = squaresY;
    const pixInSquareX = widthPx / w;
    const pixInSquareY = heightPx / h;
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
    return {startX, startY, pixInSquare, pixBoardW, pixBoardH};
}

/** Left and right (exclusive) pixel X for square columns [gx0, gx1), matching checker cell edges. */
export function charucoCropXRange(
    gx0: number,
    gx1: number,
    layout: ReturnType<typeof charucoBoardPixelLayout>,
): [number, number] {
    const x0 = Math.round(gx0 * layout.pixInSquare);
    const x1 = Math.round(gx1 * layout.pixInSquare);
    const left = layout.startX + x0;
    const rightEx = layout.startX + Math.min(x1, layout.pixBoardW);
    return [left, rightEx];
}

/** Top and bottom (exclusive) pixel Y for square rows [gy0, gy1), matching checker cell edges. */
export function charucoCropYRange(
    gy0: number,
    gy1: number,
    layout: ReturnType<typeof charucoBoardPixelLayout>,
): [number, number] {
    const y0 = Math.round(gy0 * layout.pixInSquare);
    const y1 = Math.round(gy1 * layout.pixInSquare);
    const top = layout.startY + y0;
    const bottomEx = layout.startY + Math.min(y1, layout.pixBoardH);
    return [top, bottomEx];
}

export interface CharucoMarkerModel {
    id: number;
    /** Axis-aligned corners in board plane (mm); OpenCV order: TL, TR, BR, BL. */
    cornersMm: [{x: number; y: number}, {x: number; y: number}, {x: number; y: number}, {x: number; y: number}];
}

/** Marker layout matching `CharucoBoardImpl::createCharucoBoard` (OpenCV ≥4.6 default / non-legacy). */
export function buildCharucoMarkers(geom: CharucoGeometry): CharucoMarkerModel[] {
    const {squaresX, squaresY, squareLength, markerLength} = geom;
    const diff = (squareLength - markerLength) / 2;
    const markers: CharucoMarkerModel[] = [];
    let nextId = 0;
    for (let y = 0; y < squaresY; y++) {
        for (let x = 0; x < squaresX; x++) {
            const skip = y % 2 === x % 2;
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
    const {squaresX: w, squaresY: h, squareLength, markerLength} = geom;
    const img = new Uint8Array(widthPx * heightPx);
    img.fill(255);

    const {startX, startY, pixInSquare, pixBoardW, pixBoardH} = charucoBoardPixelLayout(widthPx, heightPx, w, h);

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
            const isBlack = y % 2 === x % 2;
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
    ctx.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
}

function arucoMarkerSvgRects(id: number, sidePx: number, borderBits: number): string {
    const markerSize = ARUCO_MARKER_SIZE_4X4;
    const tiny = markerSize + 2 * borderBits;
    const byte0 = DICT_4X4_250_ROT0_BYTES[id * 2]!;
    const byte1 = DICT_4X4_250_ROT0_BYTES[id * 2 + 1]!;
    const bits = getBitsFromByteList(new Uint8Array([byte0, byte1]), markerSize);
    const parts: string[] = [];
    for (let row = 0; row < tiny; row++) {
        const y0 = Math.round((row * sidePx) / tiny);
        const y1 = Math.round(((row + 1) * sidePx) / tiny);
        const rh = Math.max(0, y1 - y0);
        for (let col = 0; col < tiny; col++) {
            const x0 = Math.round((col * sidePx) / tiny);
            const x1 = Math.round(((col + 1) * sidePx) / tiny);
            const rw = Math.max(0, x1 - x0);
            let black = false;
            if (row < borderBits || row >= tiny - borderBits || col < borderBits || col >= tiny - borderBits) {
                black = true;
            } else {
                const br = row - borderBits;
                const bc = col - borderBits;
                black = bits[br * markerSize + bc]! === 1;
            }
            if (black && rw > 0 && rh > 0) {
                parts.push(`<rect x="${x0}" y="${y0}" width="${rw}" height="${rh}" fill="#000"/>`);
            }
        }
    }
    return parts.join('');
}

/** Inner `<g>` for a ChArUco board in pixel coordinates (same layout as `renderCharucoBoardGray`). */
export function renderCharucoBoardSvgFragment(
    widthPx: number,
    heightPx: number,
    geom: CharucoGeometry,
): string {
    const {squaresX: w, squaresY: h, squareLength, markerLength} = geom;
    const parts: string[] = ['<g fill="#000">'];
    const {startX, startY, pixInSquare, pixBoardW, pixBoardH} = charucoBoardPixelLayout(widthPx, heightPx, w, h);

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

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (y % 2 !== x % 2) {
                continue;
            }
            const x0 = Math.round(x * pixInSquare);
            const y0 = Math.round(y * pixInSquare);
            const x1 = Math.round((x + 1) * pixInSquare);
            const y1 = Math.round((y + 1) * pixInSquare);
            const rw = Math.min(x1, pixBoardW) - x0;
            const rh = Math.min(y1, pixBoardH) - y0;
            if (rw > 0 && rh > 0) {
                parts.push(
                    `<rect x="${startX + x0}" y="${startY + y0}" width="${rw}" height="${rh}"/>`,
                );
            }
        }
    }

    for (const m of markers) {
        const oc0 = m.cornersMm[0]!;
        const oc2 = m.cornersMm[2]!;
        const p0 = {x: ((oc0.x - minX) / sizeX) * arucoW, y: ((oc0.y - minY) / sizeY) * arucoH};
        const p2 = {x: ((oc2.x - minX) / sizeX) * arucoW, y: ((oc2.y - minY) / sizeY) * arucoH};
        const dstW = Math.round(p2.x - p0.x);
        const dstH = Math.round(p2.y - p0.y);
        const side = Math.min(dstW, dstH);
        if (side < 6) {
            continue;
        }
        const dx = zoneOffX + Math.round(p0.x);
        const dy = zoneOffY + Math.round(p0.y);
        parts.push(
            `<g transform="translate(${dx} ${dy})" shape-rendering="crispEdges">${arucoMarkerSvgRects(m.id, side, 1)}</g>`,
        );
    }
    parts.push('</g>');
    return parts.join('');
}

/** Standalone SVG document for a ChArUco board at pixel resolution. */
export function renderCharucoBoardSvg(
    widthPx: number,
    heightPx: number,
    geom: CharucoGeometry,
): string {
    const inner = renderCharucoBoardSvgFragment(widthPx, heightPx, geom);
    return (
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} ${heightPx}" width="${widthPx}" height="${heightPx}">` +
        `<rect width="100%" height="100%" fill="#fff"/>` +
        inner +
        `</svg>`
    );
}
