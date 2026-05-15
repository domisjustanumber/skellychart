/** Aligned with `charuco_board_print.py` / `charucoPrintLayout.ts` in freemocap. */

/** Blank margin reserved on every sheet edge before join strips and printable content (mm). */
export const MM_MARGIN_SHEET = 13;
export const MM_PAGE_NUMBER_CLEARANCE_MM = 4;
export const MM_JOIN_STRIP = 12;
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

/**
 * Conservative slab (mm) when banner height cannot be measured (no canvas) on portrait-shaped sheets.
 * Rendered layout uses one top-aligned banner row on both orientations; this stays as a safe upper bound.
 * @see {@link ORIGIN_BANNER_STRIP_FALLBACK_NO_CANVAS_LANDSCAPE_MM} for landscape-shaped fallback.
 */
export const ORIGIN_PAGE_EXTRA_MM = 77;
/**
 * No-canvas fallback strip height (mm) for landscape-shaped sheets (tiling passes `portraitQrAboveCharucoInfo === false`).
 * Must stay plausible vs real SVG; feasibility uses canvas measurement when available.
 * Calibrated for US Letter landscape printable height (~205.9 mm): five rows at 34 mm need
 * strip + {@link ORIGIN_CORNER_MARKER_PAD_MM} ≤ ~35.9 mm → strip ≈ 32.9 mm.
 */
export const ORIGIN_BANNER_STRIP_FALLBACK_NO_CANVAS_LANDSCAPE_MM = 32;
/** Extra inset (mm) below {@link MM_MARGIN_SHEET} before banner content; 0 = flush to sheet margin. */
export const ORIGIN_BANNER_CONTENT_TOP_MM = 0;
/** Extra inset (mm) inside {@link MM_MARGIN_SHEET} on left/right before banner content; 0 = flush to sheet margin. */
export const ORIGIN_BANNER_CONTENT_SIDE_MM = 0;
export const MM_ORIGIN_BANNER_BELOW_GAP_MM =
    Math.round((5 * ORIGIN_BANNER_VISUAL_SCALE + Number.EPSILON) * 10) / 10;
export const ORIGIN_CORNER_MARKER_PAD_MM = 3;
export const ORIGIN_GAP_QR_TO_BOARD_INFO_MM = 2.5;
export const ORIGIN_GAP_BOARD_INFO_TO_INSTRUCTIONS_MM = 3;
export const ORIGIN_GAP_SKELLY_TO_INSTRUCTIONS_MM = 4;
export const ORIGIN_MARKER_AXIS_X_RGB: [number, number, number] = [0xa5, 0x28, 0x25];
export const ORIGIN_MARKER_AXIS_Y_RGB: [number, number, number] = [0x33, 0x6c, 0x34];
export const JOIN_MEET_DASH_RGB: [number, number, number] = [90, 90, 90];
export const PIXELS_PER_MM = 12;
export const CHARUCO_PRINT_LABEL_SPEC_VERSION = 1;

const DEFAULT_CHARUCO_PRINT_SOURCE_URL =
    'https://docs.freemocap.org/documentation/multi-camera-calibration.html';

function resolveCharucoPrintSourceUrl(): string {
    const v = import.meta.env.VITE_CHARUCO_PRINT_SOURCE_URL;
    if (typeof v === 'string') {
        const t = v.trim();
        if (t.length > 0) {
            return t;
        }
    }
    if (import.meta.env.DEV && typeof window !== 'undefined') {
        return `${window.location.origin}/`;
    }
    return DEFAULT_CHARUCO_PRINT_SOURCE_URL;
}

/**
 * Base URL QR codes on printed charts open.
 * - Explicit: `VITE_CHARUCO_PRINT_SOURCE_URL`.
 * - `npm run dev` in the browser: current dev server origin (including Vite’s chosen port).
 * - Otherwise: FreeMoCap documentation.
 *
 * Call this when generating URLs (e.g. QR codes) so dev mode always sees the live port.
 */
export function getCharucoPrintSourceUrl(): string {
    return resolveCharucoPrintSourceUrl();
}

export const OPENCV_LABEL_VERSION = '4.10+';
/** Default marker edge length as a fraction of square length (OpenCV Charuco-style). */
export const CHARUCO_MARKER_LENGTH_RATIO = 0.8;

export const PAPER_SIZES_MM: Record<string, [number, number]> = {
    a4: [210, 297],
    a3: [297, 420],
    letter: [215.9, 279.4],
    tabloid: [279.4, 431.8],
};
