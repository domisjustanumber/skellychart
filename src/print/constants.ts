/** Print layout constants. Originally aligned with freemocap's `charuco_board_print.py`; margins now differ (`sheetGeometry.ts`). */

/*
 * Safe printing margins per paper edge, and the board region on each sheet, are in `sheetGeometry.ts`.
 */

/**
 * Type size (px at {@link PIXELS_PER_MM}) of the header line and the tape labels on chart sheets. It is
 * their own size, not the banner's, so banner type edits never move the header.
 */
export const SHEET_HEADER_FONT_PX = 34;
/**
 * Baseline of the header line on chart sheets without the banner (mm from the top edge). At
 * {@link SHEET_HEADER_FONT_PX} its ink (cap height to descenders) runs about 8.5–11.2 mm down, inside the
 * safe top margin (`sheetGeometry.ts`) and above {@link MM_HEADER_CONTENT_TOP_MM}; `npm run check:banner`
 * checks both. The bottom edge is no place for it: HP DeskJets lose the last 12.7 mm.
 */
export const MM_SHEET_HEADER_BASELINE_MM = 10.6;
/** Top of the board region below the header line (mm from the top edge). */
export const MM_HEADER_CONTENT_TOP_MM = 12.5;
/** Least space between the header's left, middle and right parts (mm). */
export const MM_SHEET_HEADER_GAP_MM = 5;
/**
 * Band (mm) between the board and the safe margin at a seam, cut away during assembly: it holds only the
 * tape label ({@link MM_TAPE_LABEL_INSET_FROM_JOIN_MM} plus the label's own height at
 * {@link SHEET_HEADER_FONT_PX}). That is 30 + 32 of its 72 px, so the top and bottom labels are placed
 * without a clamp; keep it so if either grows.
 */
export const MM_SEAM_LABEL_BAND_MM = 6;
export const MM_TAPE_LABEL_INSET_FROM_JOIN_MM = 2.5;

/** Baseline QR height (mm) before banner enlargement — drives proportional scaling of banner type and gaps. */
export const ORIGIN_BANNER_QR_BASELINE_MM = 17;
/** Added to QR and logo height so the top banner is easier to read and the QR scans more reliably. */
export const ORIGIN_BANNER_VERTICAL_BUMP_MM = 5;

export const QR_SIZE_MM = ORIGIN_BANNER_QR_BASELINE_MM + ORIGIN_BANNER_VERTICAL_BUMP_MM;
export const SKELLY_TOP_HEIGHT_MM = 16 + ORIGIN_BANNER_VERTICAL_BUMP_MM;

/** Scale vs legacy ~17 mm QR row (typography and vertical padding). */
export const ORIGIN_BANNER_VISUAL_SCALE = QR_SIZE_MM / ORIGIN_BANNER_QR_BASELINE_MM;
/**
 * Push the banner text's cap tops down slightly (mm) from the logo/QR tops (nested SVGs anchor by their
 * viewport top), so the type lines up with the graphics.
 */
export const ORIGIN_BANNER_TEXT_BASELINE_OFFSET_MM = 0.35;

/** Square length range (mm) of the Square length slider, and of the layouts it can choose. */
export const CHARUCO_SQUARE_MM_MIN = 10;
export const CHARUCO_SQUARE_MM_MAX = 225;
/** Squares per axis range of the X and Y sliders. */
export const BOARD_GRID_MIN = 2;
export const BOARD_GRID_MAX = 40;

export const MM_ORIGIN_BANNER_BELOW_GAP_MM =
    Math.round((5 * ORIGIN_BANNER_VISUAL_SCALE + Number.EPSILON) * 10) / 10;
/** Gap between the board's origin corner and the corner marker's axes (mm). */
export const ORIGIN_CORNER_MARKER_PAD_MM = 3;
/** Room left of the board for the origin corner marker (its `y` arrow reaches 3.8 mm out). */
export const ORIGIN_CORNER_MARKER_SIDE_ROOM_MM = 4;
/**
 * Room above the board for the origin corner marker (its arrow and `x` label reach about 3.8 mm up)
 * when no banner sits above it, so the marker stays out of the top margin and clear of the header.
 */
export const ORIGIN_CORNER_MARKER_TOP_ROOM_MM = 5;
export const ORIGIN_GAP_QR_TO_BOARD_INFO_MM = 2.5;
export const ORIGIN_GAP_BOARD_INFO_TO_INSTRUCTIONS_MM = 3;
export const ORIGIN_GAP_SKELLY_TO_INSTRUCTIONS_MM = 4;
/** Box in the chart info for writing the measured square length by hand. */
export const ORIGIN_WRITE_IN_BOX_W_MM = 12;
export const ORIGIN_WRITE_IN_BOX_H_MM = 6;
/** Gap between the write-in box and the text either side of it, and above and below it. */
export const ORIGIN_WRITE_IN_BOX_GAP_MM = 1;
export const ORIGIN_MARKER_AXIS_X_RGB: [number, number, number] = [0xa5, 0x28, 0x25];
export const ORIGIN_MARKER_AXIS_Y_RGB: [number, number, number] = [0x33, 0x6c, 0x34];
export const JOIN_MEET_DASH_RGB: [number, number, number] = [90, 90, 90];
export const PIXELS_PER_MM = 12;

/** Default marker edge length as a fraction of square length (OpenCV ChArUco-style). */
export const CHARUCO_MARKER_LENGTH_RATIO = 0.8;
