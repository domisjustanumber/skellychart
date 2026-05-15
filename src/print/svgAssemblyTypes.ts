import type {PageSpec, TilingInfo} from './tiling.js';

export interface PrintSvgParams {
    /** Paper preset (`letter`, `tabloid`, …) — selects inch vs mm for root SVG / print page box only. */
    paperId: string;
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
     * When unset or true, `renderCharucoPrintSvgCore` awaits {@link yieldToMain} between sheets
     * so spinners/layout can update. Passing `false` skips yields (fastest bulk export but can
     * freeze the UI for large page counts).
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
