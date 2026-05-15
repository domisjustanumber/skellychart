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
}

export interface PrintSvgAssemblyParams extends PrintSvgParams {
    qrSvgFragment: string;
    logoHref: string | null;
    logoWidthPx: number;
    logoHeightPx: number;
}

export interface PrintSvgResult {
    pages: string[];
    totalPages: number;
}
