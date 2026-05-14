/** Aligned with `charuco_board_print.py` / `charucoPrintLayout.ts` in freemocap. */

export const MM_MARGIN_SHEET = 5;
export const MM_PAGE_NUMBER_CLEARANCE_MM = 4;
export const MM_JOIN_STRIP = 12;
export const MM_TAPE_LABEL_INSET_FROM_JOIN_MM = 2.5;
export const QR_SIZE_MM = 17;
export const SKELLY_TOP_HEIGHT_MM = 16;
export const ORIGIN_PAGE_EXTRA_MM = 65;
export const ORIGIN_BANNER_CONTENT_TOP_MM = 3;
export const ORIGIN_BANNER_CONTENT_SIDE_MM = 3;
export const MM_ORIGIN_BANNER_BELOW_GAP_MM = 5;
export const ORIGIN_CORNER_MARKER_PAD_MM = 3;
export const ORIGIN_GAP_QR_TO_BOARD_INFO_MM = 2.5;
export const ORIGIN_GAP_BOARD_INFO_TO_INSTRUCTIONS_MM = 3;
export const ORIGIN_GAP_SKELLY_TO_INSTRUCTIONS_MM = 4;
export const ORIGIN_MARKER_AXIS_X_RGB: [number, number, number] = [0xa5, 0x28, 0x25];
export const ORIGIN_MARKER_AXIS_Y_RGB: [number, number, number] = [0x33, 0x6c, 0x34];
export const JOIN_MEET_DASH_RGB: [number, number, number] = [90, 90, 90];
export const PIXELS_PER_MM = 12;
export const CHARUCO_PRINT_LABEL_SPEC_VERSION = 1;
export const CHARUCO_PRINT_SOURCE_URL =
    'https://docs.freemocap.org/documentation/multi-camera-calibration.html';
export const OPENCV_LABEL_VERSION = '4.10+';

export const PAPER_SIZES_MM: Record<string, [number, number]> = {
    a4: [210, 297],
    a3: [297, 420],
    letter: [215.9, 279.4],
    tabloid: [279.4, 431.8],
};
