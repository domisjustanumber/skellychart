import type {PageSpec, TilingInfo} from './tiling.js';

export interface PrintSvgParams {
    squaresX: number;
    squaresY: number;
    squareLengthMm: number;
    paperWMm: number;
    paperHMm: number;
    markerLengthRatio: number;
    tiling: TilingInfo;
    pages: PageSpec[];
    documentationSourceUrl?: string;
    signal?: AbortSignal;
    /**
     * When true (default), `renderCharucoPrintSvgCore` awaits {@link yieldToMain} between tile
     * pages so the UI can breathe. Preview passes `false` — each yield waits ~2 frames, so many
     * sheets multiplied by ~25–35ms/frame dominates wall time while sync work looks “instant”.
     */
    cooperativeYield?: boolean;
}

export interface PrintSvgAssemblyParams extends PrintSvgParams {
    qrSvgFragment: string;
    /** Inner markup only (no outer `<svg>`); nested on the sheet for Inkscape/browser compatibility. */
    logoSvgInner: string | null;
    logoWidthPx: number;
    logoHeightPx: number;
}

export interface PrintSvgResult {
    pages: string[];
    totalPages: number;
}
