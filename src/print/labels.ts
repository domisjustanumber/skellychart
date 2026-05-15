/** English on-sheet strings (defaults from freemocap `charuco_pdf_labels.py`). */

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function interpolate(template: string, vars: Record<string, string | number>): string {
    return template.replace(PLACEHOLDER, (_, key: string) =>
        key in vars ? String(vars[key]) : `{{${key}}}`,
    );
}

export const pdfLabels = {
    tapeJoinNearPage: 'Cut the dashed line away and butt this edge up against page {{page}}',
    pageFooter: 'Page {{current}} of {{total}}',
    originInstructionsTitle: 'Instructions',
    /** Single multi-line block for the instructions column (wrapped when laid out). */
    originInstructionsBody: `Print at 1:1 or 100% scale. In the print dialog, disable "Fit to page", "Shrink to fit", and any similar scaling.
Measure a black square with a ruler to ensure the printed size matches the "Square length" in the chart to the right.
Curvature will affect camera calibration — mount the chart flat on a rigid board so it cannot bend or flop.
Multi-sheet charts: cut along the dotted seam lines (remove the dashed line entirely), then assemble the chart on a rigid board.
For instructions on how to use the chart, buy a pre-made one, or print another, scan the QR code in the top corner.`,
    /**
     * Single multi-line block for ChAruCo metadata beside the QR code. First line is rendered bold;
     * remaining lines are wrapped as body text (see {@link originChartInfoParts}).
     */
    originChartInfo: `ChAruCo calibration chart v{{version}}
Square length: {{mm}} mm
Width: {{squaresX}} squares
Height: {{squaresY}} squares
OpenCV {{opencv_version}} {{dictionary_name}}`,
} as const;

export type OriginChartInfoVars = {
    version: string | number;
    mm: string | number;
    squaresX: string | number;
    squaresY: string | number;
    opencv_version: string;
    dictionary_name: string;
};

/** First line → bold title; rest → wrapped detail lines on the sheet banner. */
export function originChartInfoParts(vars: OriginChartInfoVars): {titleLine: string; bodyBlock: string} {
    const full = interpolate(pdfLabels.originChartInfo, vars);
    const idx = full.indexOf('\n');
    if (idx === -1) {
        return {titleLine: full, bodyBlock: ''};
    }
    return {titleLine: full.slice(0, idx), bodyBlock: full.slice(idx + 1)};
}
