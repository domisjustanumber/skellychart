/**
 * Where a sheet can safely be printed, and where each sheet's board may go. Tiling (`tiling.ts`) sizes
 * the sheets with these regions and the renderer (`svgAssemblyCore.ts`) places the board in them, so
 * the two always agree.
 *
 * Nothing on a sheet is scaled, so anything a printer cannot reach is simply lost. Margins are set per
 * physical paper edge from manufacturers' unprintable areas (standard, not borderless, printing) plus
 * 1.5 mm for paper skew and feed tolerance:
 * - leading edge (fed first): 6 mm worst case (HP LaserJet M209dwe; inkjets reach 5 mm);
 * - trailing edge (fed last): 12.7 mm (HP DeskJet 2700/2800/4100/4200, a fixed mechanical limit);
 * - sides: 6.4 mm (Canon PIXMA on Letter);
 * - A3 and Tabloid: about 5 mm on every edge (few sources, so the side value is used throughout).
 * A4 and Letter are fed short edge first. A landscape page is turned onto the paper clockwise or
 * anticlockwise depending on the driver and viewer, so both of its short edges may be the trailing edge.
 */
import {
    MM_HEADER_CONTENT_TOP_MM,
    MM_SEAM_LABEL_BAND_MM,
    ORIGIN_CORNER_MARKER_SIDE_ROOM_MM,
    ORIGIN_CORNER_MARKER_TOP_ROOM_MM,
} from './constants.js';

/** Safe margin at the leading edge (mm): the top of a portrait A4 or Letter page. */
export const MM_SAFE_LEADING = 7.5;
/** Safe margin at the trailing edge (mm): the bottom of a portrait page, either side of a landscape one. */
export const MM_SAFE_TRAILING = 14.2;
/** Safe margin at the paper's long sides (mm), and on every edge of A3 and Tabloid. */
export const MM_SAFE_SIDE = 8;
/** Papers whose short side is at least this (mm) are A3/Tabloid class: {@link MM_SAFE_SIDE} on every edge. */
const MM_LARGE_PAPER_SHORT_SIDE = 279;

/** A distance (mm) from each edge of a sheet. */
export interface EdgesMm {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

/** Safe margins (mm) of a sheet printed `paperWMm` wide and `paperHMm` tall. */
export function sheetSafeMarginsMm(paperWMm: number, paperHMm: number): EdgesMm {
    if (Math.min(paperWMm, paperHMm) >= MM_LARGE_PAPER_SHORT_SIDE) {
        return {top: MM_SAFE_SIDE, right: MM_SAFE_SIDE, bottom: MM_SAFE_SIDE, left: MM_SAFE_SIDE};
    }
    if (paperHMm >= paperWMm) {
        return {top: MM_SAFE_LEADING, right: MM_SAFE_SIDE, bottom: MM_SAFE_TRAILING, left: MM_SAFE_SIDE};
    }
    return {top: MM_SAFE_SIDE, right: MM_SAFE_TRAILING, bottom: MM_SAFE_SIDE, left: MM_SAFE_TRAILING};
}

/** What the board region depends on: the sheet grid and the banner strip reserved on the first sheet. */
export interface SheetGridLayout {
    npx: number;
    npy: number;
    bannerReserveMm: number;
}

/**
 * Distance (mm) from each paper edge to the area the board of the sheet at (`col`, `row`) may fill.
 * Outer edges keep just the safe margin. Edges at a seam (cut away during assembly) add a band for the
 * tape label. The top of a chart sheet sits below the header line, or below the banner's strip when
 * one is reserved.
 */
export function boardRegionMm(
    paperWMm: number,
    paperHMm: number,
    layout: SheetGridLayout,
    col: number,
    row: number,
): EdgesMm {
    const m = sheetSafeMarginsMm(paperWMm, paperHMm);
    const seam = MM_SEAM_LABEL_BAND_MM;
    let top: number;
    if (row > 0) {
        top = MM_HEADER_CONTENT_TOP_MM + seam;
    } else if (layout.bannerReserveMm > 0) {
        top = m.top + layout.bannerReserveMm;
    } else {
        top = MM_HEADER_CONTENT_TOP_MM;
    }
    return {
        top,
        right: m.right + (col < layout.npx - 1 ? seam : 0),
        bottom: m.bottom + (row < layout.npy - 1 ? seam : 0),
        left: m.left + (col > 0 ? seam : 0),
    };
}

/**
 * Room (mm) the origin corner marker needs left of and above the first sheet's board. A banner's own
 * gap below it already leaves the marker room above.
 */
export function originMarkerRoomMm(bannerReserveMm: number): {top: number; left: number} {
    return {
        top: bannerReserveMm > 0 ? 0 : ORIGIN_CORNER_MARKER_TOP_ROOM_MM,
        left: ORIGIN_CORNER_MARKER_SIDE_ROOM_MM,
    };
}
