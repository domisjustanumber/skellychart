import type {PaperId} from './papers.js';
import type {TilingInfo} from './tiling.js';

/**
 * One chart as printed: the board as set on the controls and its layout. The preview, Print, Save as PDF
 * and the scale scene each render from one snapshot of it, so a control change mid-render cannot mix two.
 */
export interface PrintedChart {
    /** Paper preset: its units set the root SVG / print page box; its name goes in the sheet header. */
    paperId: PaperId;
    squaresX: number;
    squaresY: number;
    squareMm: number;
    /** The printed layout; its `paperWMm` × `paperHMm` is the chart sheet every page is drawn on. */
    tiling: TilingInfo;
}

export interface PrintSvgOptions {
    /** Render only the leading chart sheets (e.g. preview thumbnails); headers still count every sheet. */
    maxSheets?: number;
    /**
     * Awaited before each sheet, so the caller can let the page repaint (`yieldToMain`); may throw to
     * abort. Unset, the sheets are made without a break.
     */
    betweenSheets?: () => Promise<void> | void;
}

export interface PrintSvgAssemblyParams extends PrintSvgOptions {
    chart: PrintedChart;
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
    /** Chart sheets 1..N (only the leading `maxSheets` when set). */
    sheets: string[];
    /** Assembly guide printed before the chart sheets, on the same paper; `null` for a single-sheet chart. */
    guide: string | null;
}
