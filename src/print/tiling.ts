/**
 * Sheet tiling for ChaRuCo print PDFs — same convergence as `charucoPrintLayout.ts` /
 * `_compute_tiling` in `charuco_board_print.py`.
 */
import {
    MM_JOIN_STRIP,
    MM_MARGIN_SHEET,
    ORIGIN_CORNER_MARKER_PAD_MM,
    ORIGIN_PAGE_EXTRA_MM,
} from './constants.js';

export interface TilingInfo {
    pageCount: number;
    maxCx: number;
    maxCyFirst: number;
    maxCyRest: number;
    npx: number;
    npy: number;
    landscape: boolean;
}

export interface PageSpec {
    gx0: number;
    gx1: number;
    gy0: number;
    gy1: number;
    sheetIndex: number;
    isOriginPage: boolean;
    npx: number;
    npy: number;
    col: number;
    row: number;
}

function computeTilingInfoSingle(
    squaresX: number,
    squaresY: number,
    squareMm: number,
    paperWMm: number,
    paperHMm: number,
): Omit<TilingInfo, 'landscape'> | null {
    const ph = paperHMm - 2 * MM_MARGIN_SHEET;
    if (ph <= 0) {
        return null;
    }

    let joinW = 0;
    let npyForJoin = 1;
    let npx = 1;
    let npy = 1;
    let maxCx = 1;
    let maxCyFirst = 0;
    let maxCyRest = 0;
    let converged = false;

    for (let i = 0; i < 24; i++) {
        const pw = paperWMm - 2 * MM_MARGIN_SHEET - joinW;
        if (pw <= 0) {
            return null;
        }
        const pwForCols = pw - ORIGIN_CORNER_MARKER_PAD_MM;
        if (pwForCols < squareMm) {
            return null;
        }

        const joinH0 = npyForJoin > 1 ? MM_JOIN_STRIP : 0;
        const joinHr = npyForJoin > 1 ? 2 * MM_JOIN_STRIP : 0;

        const phOriginPattern = ph - ORIGIN_PAGE_EXTRA_MM - joinH0 - ORIGIN_CORNER_MARKER_PAD_MM;
        if (phOriginPattern <= squareMm) {
            return null;
        }

        maxCx = Math.floor(pwForCols / squareMm);
        maxCyFirst = Math.floor(phOriginPattern / squareMm);
        maxCyRest = Math.floor((ph - joinHr) / squareMm);
        if (maxCx < 1 || maxCyFirst < 1 || maxCyRest < 1) {
            return null;
        }

        npx = Math.ceil(squaresX / maxCx);

        let gy = 0;
        npy = 0;
        while (gy < squaresY) {
            const cap = gy === 0 ? maxCyFirst : maxCyRest;
            const gyEnd = Math.min(gy + cap, squaresY);
            gy = gyEnd;
            npy += 1;
        }

        const joinWNew = npx > 1 ? 2 * MM_JOIN_STRIP : 0;
        if (joinWNew === joinW && npyForJoin === npy) {
            converged = true;
            break;
        }
        joinW = joinWNew;
        npyForJoin = npy;
    }

    if (!converged) {
        return null;
    }

    return {
        pageCount: npx * npy,
        maxCx,
        maxCyFirst,
        maxCyRest,
        npx,
        npy,
    };
}

export function computeTilingInfo(
    squaresX: number,
    squaresY: number,
    squareMm: number,
    nominalWMm: number,
    nominalHMm: number,
): TilingInfo | null {
    if (Math.abs(nominalWMm - nominalHMm) < 0.01) {
        const t = computeTilingInfoSingle(squaresX, squaresY, squareMm, nominalWMm, nominalHMm);
        return t ? {...t, landscape: false} : null;
    }
    const portrait = computeTilingInfoSingle(squaresX, squaresY, squareMm, nominalWMm, nominalHMm);
    const landscape = computeTilingInfoSingle(squaresX, squaresY, squareMm, nominalHMm, nominalWMm);
    const scored: {
        info: Omit<TilingInfo, 'landscape'>;
        landscape: boolean;
        key: [number, number, number];
    }[] = [];
    if (portrait) {
        const prod = portrait.maxCx * portrait.maxCyRest;
        scored.push({info: portrait, landscape: false, key: [portrait.pageCount, -prod, 0]});
    }
    if (landscape) {
        const prod = landscape.maxCx * landscape.maxCyRest;
        scored.push({info: landscape, landscape: true, key: [landscape.pageCount, -prod, 1]});
    }
    if (scored.length === 0) {
        return null;
    }
    scored.sort((a, b) => {
        for (let i = 0; i < 3; i++) {
            if (a.key[i] !== b.key[i]) {
                return a.key[i]! - b.key[i]!;
            }
        }
        return 0;
    });
    const best = scored[0]!;
    return {...best.info, landscape: best.landscape};
}

export function computeTilingInfoMatchingPageCount(
    squaresX: number,
    squaresY: number,
    squareMm: number,
    nominalWMm: number,
    nominalHMm: number,
    targetPages: number,
): TilingInfo | null {
    if (Math.abs(nominalWMm - nominalHMm) < 0.01) {
        const t = computeTilingInfoSingle(squaresX, squaresY, squareMm, nominalWMm, nominalHMm);
        if (!t || t.pageCount !== targetPages) {
            return null;
        }
        return {...t, landscape: false};
    }
    const scored: {info: Omit<TilingInfo, 'landscape'>; landscape: boolean; prod: number}[] = [];
    const portrait = computeTilingInfoSingle(squaresX, squaresY, squareMm, nominalWMm, nominalHMm);
    if (portrait && portrait.pageCount === targetPages) {
        scored.push({info: portrait, landscape: false, prod: portrait.maxCx * portrait.maxCyRest});
    }
    const landscape = computeTilingInfoSingle(squaresX, squaresY, squareMm, nominalHMm, nominalWMm);
    if (landscape && landscape.pageCount === targetPages) {
        scored.push({info: landscape, landscape: true, prod: landscape.maxCx * landscape.maxCyRest});
    }
    if (scored.length === 0) {
        return null;
    }
    scored.sort((a, b) => {
        if (b.prod !== a.prod) {
            return b.prod - a.prod;
        }
        return (a.landscape ? 1 : 0) - (b.landscape ? 1 : 0);
    });
    const best = scored[0]!;
    return {...best.info, landscape: best.landscape};
}

export function selectPaperDimensionsMm(
    squaresX: number,
    squaresY: number,
    squareMm: number,
    nominalWMm: number,
    nominalHMm: number,
    targetPageCount: number | undefined,
): {paperWMm: number; paperHMm: number} {
    if (Math.abs(nominalWMm - nominalHMm) < 0.01) {
        return {paperWMm: nominalWMm, paperHMm: nominalHMm};
    }
    const scored: {nPages: number; negProd: number; pref: number; w: number; h: number}[] = [];
    for (const [effW, effH, portraitFlag] of [
        [nominalWMm, nominalHMm, true],
        [nominalHMm, nominalWMm, false],
    ] as const) {
        const pages = computePagesForPaper(squaresX, squaresY, squareMm, effW, effH);
        if (!pages) {
            continue;
        }
        const {tiling, paperWMm, paperHMm} = pages;
        if (targetPageCount !== undefined && tiling.pageCount !== targetPageCount) {
            continue;
        }
        const pw = paperWMm - 2 * MM_MARGIN_SHEET - (tiling.npx > 1 ? 2 * MM_JOIN_STRIP : 0);
        const ph = paperHMm - 2 * MM_MARGIN_SHEET;
        const maxCx = Math.floor((pw - ORIGIN_CORNER_MARKER_PAD_MM) / squareMm);
        const maxCyRest = Math.floor((ph - (tiling.npy > 1 ? 2 * MM_JOIN_STRIP : 0)) / squareMm);
        const prod = maxCx * maxCyRest;
        scored.push({
            nPages: tiling.pageCount,
            negProd: -prod,
            pref: portraitFlag ? 0 : 1,
            w: paperWMm,
            h: paperHMm,
        });
    }
    if (scored.length === 0) {
        throw new Error(
            targetPageCount !== undefined
                ? `Cannot tile this board with exactly ${targetPageCount} sheet(s) on the selected paper.`
                : 'Cannot tile this board on the selected paper (try larger paper or smaller squares).',
        );
    }
    scored.sort((a, b) => {
        if (a.nPages !== b.nPages) {
            return a.nPages - b.nPages;
        }
        if (a.negProd !== b.negProd) {
            return a.negProd - b.negProd;
        }
        return a.pref - b.pref;
    });
    const best = scored[0]!;
    return {paperWMm: best.w, paperHMm: best.h};
}

function computePagesForPaper(
    squaresX: number,
    squaresY: number,
    squareMm: number,
    effW: number,
    effH: number,
): {tiling: TilingInfo; paperWMm: number; paperHMm: number} | null {
    const t = computeTilingInfo(squaresX, squaresY, squareMm, effW, effH);
    if (!t) {
        return null;
    }
    return {tiling: t, paperWMm: effW, paperHMm: effH};
}

export function buildPageSpecs(
    squaresX: number,
    squaresY: number,
    tiling: TilingInfo,
): {pages: PageSpec[]; npx: number; npy: number} {
    const {maxCx, maxCyFirst, maxCyRest, npx} = tiling;
    const rowRanges: [number, number][] = [];
    let gy = 0;
    while (gy < squaresY) {
        const cap = gy === 0 ? maxCyFirst : maxCyRest;
        const gyEnd = Math.min(gy + cap, squaresY);
        rowRanges.push([gy, gyEnd]);
        gy = gyEnd;
    }
    const npy = rowRanges.length;
    const pages: PageSpec[] = [];
    let sheet = 0;
    for (let row = 0; row < rowRanges.length; row++) {
        const [gy0, gy1] = rowRanges[row]!;
        for (let col = 0; col < npx; col++) {
            sheet += 1;
            const gx0 = col * maxCx;
            const gx1 = Math.min(gx0 + maxCx, squaresX);
            pages.push({
                gx0,
                gx1,
                gy0,
                gy1,
                sheetIndex: sheet,
                isOriginPage: col === 0 && row === 0,
                npx,
                npy,
                col,
                row,
            });
        }
    }
    return {pages, npx, npy};
}
