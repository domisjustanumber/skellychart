import type {PaperId} from './papers.js';
import type {PageSpec, TilingInfo} from './tiling.js';

export interface PrintSvgParams {
    /** Paper preset: its units set the root SVG / print page box; its name goes in the sheet header. */
    paperId: PaperId;
    squaresX: number;
    squaresY: number;
    squareLengthMm: number;
    markerLengthRatio: number;
    /** The printed layout; its `paperWMm` × `paperHMm` is the chart sheet every page is drawn on. */
    tiling: TilingInfo;
    /** Sheets to render; may be a leading subset of the layout (e.g. preview thumbnails). */
    pages: PageSpec[];
    /** Chart sheets in the whole layout, for the header's "Page N of M"; defaults to `pages.length`. */
    totalPages?: number;
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
    /** Chart link the QR encodes; also printed in every sheet's header. */
    chartUrl: string;
    /**
     * Inner markup only (no outer `<svg>`); nested on the sheet for Inkscape/browser compatibility.
     * `null` when the logo did not load: the banner then leaves no room for it.
     */
    logoSvgInner: string | null;
}

/** One printed sheet whose size differs from the chart sheets'. */
export interface PrintSheetSvg {
    svg: string;
    paperWMm: number;
    paperHMm: number;
}

export interface PrintSvgResult {
    pages: string[];
    totalPages: number;
    /** Assembly guide printed before the chart sheets; `null` for a single-sheet chart. */
    guide: PrintSheetSvg | null;
}
