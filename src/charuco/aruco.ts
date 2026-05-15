import {DICT_4X4_250_ROT0_BYTES} from '../generated/dict4x4_250_rot0.js';

export const ARUCO_MARKER_SIZE_4X4 = 4;

/** Decode marker id rotation-0 bytes into a 4×4 grid of 0/1 (OpenCV `Dictionary::getBitsFromByteList`). */
export function getBitsFromByteList(byteListRot0: Uint8Array, markerSize: number): Uint8Array {
    const bits = new Uint8Array(markerSize * markerSize);
    const base2List = [128, 64, 32, 16, 8, 4, 2, 1];
    let currentByteIdx = 0;
    let currentByte = byteListRot0[0]!;
    let currentBit = 0;
    const totalBits = markerSize * markerSize;
    let o = 0;
    for (let row = 0; row < markerSize; row++) {
        for (let col = 0; col < markerSize; col++) {
            if (currentByte >= base2List[currentBit]!) {
                bits[o] = 1;
                currentByte -= base2List[currentBit]!;
            }
            o++;
            currentBit++;
            if (currentBit === 8) {
                currentByteIdx++;
                currentByte =
                    currentByteIdx < byteListRot0.length ? byteListRot0[currentByteIdx]! : 0;
                if (8 * (currentByteIdx + 1) > totalBits) {
                    currentBit = 8 * (currentByteIdx + 1) - totalBits;
                } else {
                    currentBit = 0;
                }
            }
        }
    }
    return bits;
}

/** Grayscale marker image `sidePixels`×`sidePixels`, borderBits default 1 (OpenCV). */
export function generateImageMarker(id: number, sidePixels: number, borderBits: number): Uint8Array {
    const markerSize = ARUCO_MARKER_SIZE_4X4;
    if (id < 0 || id >= 250) {
        throw new RangeError(`ArUco id ${id} out of range for DICT_4X4_250`);
    }
    if (sidePixels < markerSize + 2 * borderBits) {
        throw new RangeError(`sidePixels too small for marker`);
    }
    const tiny = markerSize + 2 * borderBits;
    const tinyMarker = new Uint8Array(tiny * tiny);
    for (let i = 0; i < tinyMarker.length; i++) {
        tinyMarker[i] = 0;
    }
    const byte0 = DICT_4X4_250_ROT0_BYTES[id * 2]!;
    const byte1 = DICT_4X4_250_ROT0_BYTES[id * 2 + 1]!;
    const bits = getBitsFromByteList(new Uint8Array([byte0, byte1]), markerSize);
    let bi = 0;
    for (let row = 0; row < markerSize; row++) {
        for (let col = 0; col < markerSize; col++) {
            const v = bits[bi++]! * 255;
            const tr = borderBits + row;
            const tc = borderBits + col;
            tinyMarker[tr * tiny + tc] = v;
        }
    }
    const out = new Uint8Array(sidePixels * sidePixels);
    for (let sy = 0; sy < tiny; sy++) {
        const y0 = Math.round((sy * sidePixels) / tiny);
        const y1 = Math.round(((sy + 1) * sidePixels) / tiny);
        for (let sx = 0; sx < tiny; sx++) {
            const x0 = Math.round((sx * sidePixels) / tiny);
            const x1 = Math.round(((sx + 1) * sidePixels) / tiny);
            const v = tinyMarker[sy * tiny + sx]!;
            for (let y = y0; y < y1; y++) {
                const rowOff = y * sidePixels;
                for (let x = x0; x < x1; x++) {
                    out[rowOff + x] = v;
                }
            }
        }
    }
    return out;
}
