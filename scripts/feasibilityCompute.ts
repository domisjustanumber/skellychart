/**
 * Pure feasibility buffer computation for codegen (main thread or worker_threads).
 */
import {computeTilingInfo, computeTilingInfoMatchingPageCount} from '../src/print/tiling.js';

export const BOARD_GRID_MIN = 2;
export const BOARD_GRID_MAX = 40;
export const PAGE_COUNT_MIN = 1;
export const PAGE_COUNT_MAX = 9;
export const SQ_MIN = 10;
export const SQ_MAX = 200;

export const GRID_SPAN = BOARD_GRID_MAX - BOARD_GRID_MIN + 1;
export const SLOT_COUNT_PER_PAPER = GRID_SPAN * GRID_SPAN;
export const SQ_BITMAP_BYTES = Math.ceil((SQ_MAX - SQ_MIN + 1) / 8);

export interface PaperFeasibilityBuffers {
    validPagesBits: Uint16Array;
    maxSqMmPacked: Int8Array;
    anySqBitmap: Uint8Array;
}

export function gridSlotIndex(squaresX: number, squaresY: number): number {
    return (squaresX - BOARD_GRID_MIN) * GRID_SPAN + (squaresY - BOARD_GRID_MIN);
}

function encodeMmListToBitmap(mmList: number[], dst: Uint8Array, byteOffset: number): void {
    dst.fill(0, byteOffset, byteOffset + SQ_BITMAP_BYTES);
    for (const mm of mmList) {
        const bit = mm - SQ_MIN;
        dst[byteOffset + (bit >> 3)]! |= 1 << (bit & 7);
    }
}

export function paperBuffersToBase64(buf: PaperFeasibilityBuffers): {
    b64ValidPages: string;
    b64MaxSq: string;
    b64AnySq: string;
} {
    return {
        b64ValidPages: Buffer.from(buf.validPagesBits.buffer, buf.validPagesBits.byteOffset, buf.validPagesBits.byteLength).toString(
            'base64',
        ),
        b64MaxSq: Buffer.from(buf.maxSqMmPacked.buffer, buf.maxSqMmPacked.byteOffset, buf.maxSqMmPacked.byteLength).toString(
            'base64',
        ),
        b64AnySq: Buffer.from(buf.anySqBitmap.buffer, buf.anySqBitmap.byteOffset, buf.anySqBitmap.byteLength).toString('base64'),
    };
}

function squareSizeFitsTargetPageCountEitherOrientation(
    squaresX: number,
    squaresY: number,
    squareMm: number,
    paperWMm: number,
    paperHMm: number,
    targetPages: number,
): boolean {
    if (computeTilingInfoMatchingPageCount(squaresX, squaresY, squareMm, paperWMm, paperHMm, targetPages) !== null) {
        return true;
    }
    if (squaresX !== squaresY) {
        return (
            computeTilingInfoMatchingPageCount(squaresY, squaresX, squareMm, paperWMm, paperHMm, targetPages) !== null
        );
    }
    return false;
}

function maxSquareMmForGridAndPages(
    squaresX: number,
    squaresY: number,
    paperWMm: number,
    paperHMm: number,
    targetPages: number,
): number | null {
    for (let s = SQ_MAX; s >= SQ_MIN; s--) {
        if (squareSizeFitsTargetPageCountEitherOrientation(squaresX, squaresY, s, paperWMm, paperHMm, targetPages)) {
            return s;
        }
    }
    return null;
}

function validTargetPageCountsForGrid(
    squaresX: number,
    squaresY: number,
    paperWMm: number,
    paperHMm: number,
): number[] {
    const out: number[] = [];
    for (let p = PAGE_COUNT_MIN; p <= PAGE_COUNT_MAX; p++) {
        let any = false;
        for (let s = SQ_MIN; s <= SQ_MAX; s++) {
            if (squareSizeFitsTargetPageCountEitherOrientation(squaresX, squaresY, s, paperWMm, paperHMm, p)) {
                any = true;
                break;
            }
        }
        if (any) {
            out.push(p);
        }
    }
    return out;
}

function enumerateValidSquareSizes(
    squaresX: number,
    squaresY: number,
    paperWMm: number,
    paperHMm: number,
): number[] {
    const out = new Set<number>();
    for (let s = SQ_MIN; s <= SQ_MAX; s++) {
        if (computeTilingInfo(squaresX, squaresY, s, paperWMm, paperHMm) !== null) {
            out.add(s);
        } else if (squaresX !== squaresY && computeTilingInfo(squaresY, squaresX, s, paperWMm, paperHMm) !== null) {
            out.add(s);
        }
    }
    return [...out].sort((a, b) => a - b);
}

export function computePaperFeasibilityBuffers(wMm: number, hMm: number): PaperFeasibilityBuffers {
    const validPagesBits = new Uint16Array(SLOT_COUNT_PER_PAPER);
    const maxSqMmPacked = new Int8Array(SLOT_COUNT_PER_PAPER * 9);
    const anySqBitmap = new Uint8Array(SLOT_COUNT_PER_PAPER * SQ_BITMAP_BYTES);

    for (let sx = BOARD_GRID_MIN; sx <= BOARD_GRID_MAX; sx++) {
        for (let sy = BOARD_GRID_MIN; sy <= BOARD_GRID_MAX; sy++) {
            const slot = gridSlotIndex(sx, sy);

            const targets = validTargetPageCountsForGrid(sx, sy, wMm, hMm);
            let bits = 0;
            for (const p of targets) {
                bits |= 1 << (p - 1);
            }
            validPagesBits[slot] = bits;

            const squaresAny = enumerateValidSquareSizes(sx, sy, wMm, hMm);
            encodeMmListToBitmap(squaresAny, anySqBitmap, slot * SQ_BITMAP_BYTES);

            for (let p = PAGE_COUNT_MIN; p <= PAGE_COUNT_MAX; p++) {
                const maxSq = maxSquareMmForGridAndPages(sx, sy, wMm, hMm, p);
                maxSqMmPacked[slot * 9 + (p - 1)] = maxSq === null ? -1 : maxSq;
            }
        }
    }

    return {validPagesBits, maxSqMmPacked, anySqBitmap};
}
