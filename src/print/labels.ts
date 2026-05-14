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
    originInstructions: `Print at 1:1 or 100% scale. In the print dialog, disable "Fit to page", "Shrink to fit", and any similar scaling.
Measure a black square with a ruler to ensure the printed size matches the "Square length" in the chart to the right.
Curvature will affect camera calibration — mount the chart flat on a rigid board so it cannot bend or flop.
Multi-sheet charts: cut along the dotted seam lines (remove the dashed line entirely), then assemble the chart on a rigid board.`,
    originInstructionsDocumentationFooter:
        'For instructions on how to use the chart, buy a pre-made one, or print another, scan the QR code in the top corner.',
    originTitleLine: 'ChaRuCo calibration chart v{{version}}',
    originSquareSizeLine: 'Square length: {{mm}} mm',
    originWidthLine: 'Width: {{n}} squares',
    originHeightLine: 'Height: {{n}} squares',
    originOpenCvLine: 'OpenCV {{opencv_version}} {{dictionary_name}}',
} as const;
