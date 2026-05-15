/**
 * Loads one paper’s feasibility blob at a time (Vite code-splits `generated/tilingFeasibilityPaper-*.js`).
 * Until the chunk resolves, {@link charucoLayout.ts} helpers fall back to runtime tiling scans.
 */
import {
    feasibilityPaperIdFromDims,
    resolveFeasibilityGridSlot,
    TILING_FEASIBILITY_PAGE_COUNT_MAX,
    TILING_FEASIBILITY_PAGE_COUNT_MIN,
    TILING_FEASIBILITY_SQ_BITMAP_BYTES,
    TILING_FEASIBILITY_SQ_MM_MAX,
    TILING_FEASIBILITY_SQ_MM_MIN,
} from './generated/tilingFeasibilityConstants.js';
import {decodeMmBitmap} from './tilingFeasibilityCodec.js';

export type PaperFeasibilityBuffers = {
    readonly VALID_PAGES_BITS: Uint16Array;
    readonly MAX_SQ_MM_PACKED: Int8Array;
    readonly ANY_SQ_BITMAP: Uint8Array;
};

let activePaperId: string | null = null;
let active: PaperFeasibilityBuffers | null = null;

async function importPaperBuffers(paperId: string): Promise<PaperFeasibilityBuffers | null> {
    switch (paperId) {
        case 'a4': {
            const m = await import('./generated/tilingFeasibilityPaper-a4.js');
            return {VALID_PAGES_BITS: m.VALID_PAGES_BITS, MAX_SQ_MM_PACKED: m.MAX_SQ_MM_PACKED, ANY_SQ_BITMAP: m.ANY_SQ_BITMAP};
        }
        case 'a3': {
            const m = await import('./generated/tilingFeasibilityPaper-a3.js');
            return {VALID_PAGES_BITS: m.VALID_PAGES_BITS, MAX_SQ_MM_PACKED: m.MAX_SQ_MM_PACKED, ANY_SQ_BITMAP: m.ANY_SQ_BITMAP};
        }
        case 'letter': {
            const m = await import('./generated/tilingFeasibilityPaper-letter.js');
            return {VALID_PAGES_BITS: m.VALID_PAGES_BITS, MAX_SQ_MM_PACKED: m.MAX_SQ_MM_PACKED, ANY_SQ_BITMAP: m.ANY_SQ_BITMAP};
        }
        case 'tabloid': {
            const m = await import('./generated/tilingFeasibilityPaper-tabloid.js');
            return {VALID_PAGES_BITS: m.VALID_PAGES_BITS, MAX_SQ_MM_PACKED: m.MAX_SQ_MM_PACKED, ANY_SQ_BITMAP: m.ANY_SQ_BITMAP};
        }
        default:
            return null;
    }
}

/** Fetch & decode the feasibility tables for this preset paper id (idempotent). */
export async function ensureTilingFeasibilityForPaperId(paperId: string): Promise<void> {
    if (activePaperId === paperId && active !== null) {
        return;
    }
    activePaperId = null;
    active = null;
    const buffers = await importPaperBuffers(paperId);
    if (buffers === null) {
        return;
    }
    activePaperId = paperId;
    active = buffers;
}

export function resolveStaticFeasibilitySlot(
    paperWMm: number,
    paperHMm: number,
    squaresX: number,
    squaresY: number,
): number | undefined {
    const expectedId = feasibilityPaperIdFromDims(paperWMm, paperHMm);
    if (expectedId === undefined || activePaperId !== expectedId || active === null) {
        return undefined;
    }
    return resolveFeasibilityGridSlot(squaresX, squaresY);
}

export function staticValidTargetPageCounts(slot: number): number[] {
    if (active === null) {
        return [];
    }
    const bits = active.VALID_PAGES_BITS[slot]!;
    const out: number[] = [];
    for (let p = TILING_FEASIBILITY_PAGE_COUNT_MIN; p <= TILING_FEASIBILITY_PAGE_COUNT_MAX; p++) {
        if (bits & (1 << (p - 1))) {
            out.push(p);
        }
    }
    return out;
}

export function staticMaxSquareMmForPages(slot: number, targetPages: number): number | null {
    if (active === null) {
        return null;
    }
    const v = active.MAX_SQ_MM_PACKED[slot * TILING_FEASIBILITY_PAGE_COUNT_MAX + (targetPages - 1)]!;
    return v < 0 ? null : v;
}

export function staticEnumerateValidSquareMm(slot: number): number[] {
    if (active === null) {
        return [];
    }
    return decodeMmBitmap(
        active.ANY_SQ_BITMAP,
        slot * TILING_FEASIBILITY_SQ_BITMAP_BYTES,
        TILING_FEASIBILITY_SQ_MM_MIN,
        TILING_FEASIBILITY_SQ_MM_MAX,
    );
}
