/** Print layout constants. Originally aligned with freemocap's `charuco_board_print.py`; margins now differ (`sheetGeometry.ts`). */

import {resolveQrLinkSourceUrl, resolveQrLinkSourceUrlFor, type QrLinkTarget} from './qrLinkTarget.js';

/*
 * Safe printing margins per paper edge, and the board region on each sheet, are in `sheetGeometry.ts`.
 */

/**
 * Baseline of the header line on chart sheets without the banner (mm from the top edge). Its font box
 * (ascent to descent) runs about 8.0–11.2 mm down, inside the safe top margin (`sheetGeometry.ts`) and
 * above {@link MM_HEADER_CONTENT_TOP_MM}. The bottom edge is no place for it: HP DeskJets lose the last
 * 12.7 mm.
 */
export const MM_SHEET_HEADER_BASELINE_MM = 10.6;
/** Top of the board region below the header line (mm from the top edge). */
export const MM_HEADER_CONTENT_TOP_MM = 12.5;
/** Least space between the header's left, middle and right parts (mm). */
export const MM_SHEET_HEADER_GAP_MM = 5;
/**
 * Band (mm) between the board and the safe margin at a seam, cut away during assembly: it holds only the
 * tape label ({@link MM_TAPE_LABEL_INSET_FROM_JOIN_MM} plus the label's own height).
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
 * Push banner `<text>` down slightly (mm). Nested SVGs anchor by viewport top; `hanging` baseline
 * leaves Latin caps visually higher than logo/QR tops — this aligns type with graphics.
 */
export const ORIGIN_BANNER_TEXT_BASELINE_OFFSET_MM = 0.35;

/** Square length range (mm) of the Square length slider, and of the layouts it can choose. */
export const CHARUCO_SQUARE_MM_MIN = 10;
export const CHARUCO_SQUARE_MM_MAX = 225;

/** Smallest banner type scale (fraction of normal) the renderer may step down to so the banner fits its reserve. */
export const ORIGIN_BANNER_MIN_TYPE_FRACTION = 0.7;

/**
 * Key of the generated origin-banner heights (`originBannerStrip.ts`): the banner's width (mm), i.e. the
 * sheet width less its left and right safe margins, to 0.1 mm.
 */
export function bannerWidthKey(bannerWMm: number): string {
    return String(Math.round(bannerWMm * 10) / 10);
}

/** Extra inset (mm) below the safe top margin before banner content; 0 = flush to the margin. */
export const ORIGIN_BANNER_CONTENT_TOP_MM = 0;
/** Extra inset (mm) inside the left/right safe margins before banner content; 0 = flush to the margins. */
export const ORIGIN_BANNER_CONTENT_SIDE_MM = 0;
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
/**
 * Printed label/layout contract version. Must equal the major component of the app
 * version (`package.json`); bump both together when printed labels, layout, or QR
 * query semantics change. The origin banner prints the full app semver, not this.
 */
export const CHARUCO_PRINT_LABEL_SPEC_VERSION = 2;

function explicitCharucoPrintSourceUrl(): string | null {
    const v = import.meta.env.VITE_CHARUCO_PRINT_SOURCE_URL;
    if (typeof v === 'string') {
        const t = v.trim();
        if (t.length > 0) {
            return t;
        }
    }
    return null;
}

function resolveCharucoPrintSourceUrl(): string {
    return explicitCharucoPrintSourceUrl() ?? resolveQrLinkSourceUrl();
}

/**
 * Base URL QR codes on printed charts open.
 * - Explicit: `VITE_CHARUCO_PRINT_SOURCE_URL` (CI pins the skelly.cam short link).
 * - `npm run dev`: skelly.cam short link by default, so dev output matches release output.
 *   The dev-only “QR link target” switch selects the local dev server instead (encoded as a
 *   LAN URL, so phones can scan it).
 * - Otherwise: skelly.cam short link (keeps the printed QR short).
 *
 * Call this when generating URLs (e.g. QR codes) so the current dev switch is honoured.
 */
export function getCharucoPrintSourceUrl(): string {
    return resolveCharucoPrintSourceUrl();
}

/**
 * Base URL QR codes would encode for an explicit target, regardless of the current dev
 * selection. Used by the dev-only QR link target UI to show what each option produces.
 */
export function getCharucoPrintSourceUrlFor(target: QrLinkTarget): string {
    return explicitCharucoPrintSourceUrl() ?? resolveQrLinkSourceUrlFor(target);
}

/** OpenCV version written into the legacy `cv2` QR metadata (not printed on the sheet). */
export const OPENCV_LABEL_VERSION = '4.10+';
/** Default marker edge length as a fraction of square length (OpenCV ChArUco-style). */
export const CHARUCO_MARKER_LENGTH_RATIO = 0.8;

export const PAPER_SIZES_MM: Record<string, [number, number]> = {
    a4: [210, 297],
    a3: [297, 420],
    letter: [215.9, 279.4],
    tabloid: [279.4, 431.8],
};
