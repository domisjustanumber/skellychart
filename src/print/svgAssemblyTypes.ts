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
    /**
     * Awaited before each sheet, so the caller can let the page repaint (`yieldToMain`); may throw to
     * abort. Unset, the sheets are made without a break.
     */
    betweenSheets?: () => Promise<void> | void;
}

export interface PrintSvgAssemblyParams extends PrintSvgParams {
    qrSvgFragment: string;
    /** Chart link the QR encodes; also printed in every sheet's header. */
    chartUrl: string;
    /**
     * Inner markup only (no outer `<svg>`); nested on the sheet for Inkscape/browser compatibility.
     * `null` when the logo did not load: the banner then leaves its box empty.
     */
    logoSvgInner: string | null;
}

export interface PrintSvgResult {
    pages: string[];
    /** Assembly guide printed before the chart sheets, on the same paper; `null` for a single-sheet chart. */
    guide: string | null;
}
