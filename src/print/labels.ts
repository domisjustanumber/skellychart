/** English on-sheet strings (defaults from freemocap `charuco_pdf_labels.py`). */

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function interpolate(template: string, vars: Record<string, string | number>): string {
    return template.replace(PLACEHOLDER, (_, key: string) =>
        key in vars ? String(vars[key]) : `{{${key}}}`,
    );
}

export const pdfLabels = {
    tapeJoinNearPage: 'Cut the dashed line away and butt this edge up against page {{page}}',
    assemblyGuideTitle: 'Assembly guide',
    /** Below the full chart on the guide sheet. Numbered lines wrap with a hanging indent. */
    assemblyGuideBody: `This chart prints on {{sheets}} pages, {{cols}} across and {{rows}} down. Each numbered block above shows where that page goes in the finished chart.
1. Lay the pages out as shown, with page 1 at the top left. Its red and green corner marker shows the chart's x and y directions.
2. On each page, cut the dashed line away along every edge that joins another page.
3. Butt each cut edge up against the page named beside it, keeping the squares lined up across every seam.
4. Glue the pages flat onto a rigid board with spray adhesive or a glue stick, so the chart cannot bend. Do not use tape - the reflections may cause errors when detecting the chart.`,
    /** Header line in the top margin of each sheet without the banner: brand and chart link on the left. */
    sheetHeaderBrand: 'FreeMoCap · {{url}}',
    /** Header middle; dropped when the line would not fit. */
    sheetHeaderChart: '{{squaresX}} x {{squaresY}} squares · {{mm}} mm · {{paper}}',
    /** Header right: which chart sheet this is. */
    sheetHeaderPage: 'Page {{current}} of {{total}} · row {{row}}, column {{col}}',
    sheetHeaderPaper: {a4: 'A4', a3: 'A3', letter: 'Letter', tabloid: 'Tabloid'} as Record<string, string>,
    /**
     * Slug below a print-shop board's crop marks (trimmed off), as parts joined by " | "; parts are dropped
     * from the right until the line fits. Outlined text: ASCII plus ×, no `·`.
     */
    shopSlugParts: ['PRINT AT 100% - DO NOT SCALE', 'Trim {{trim}}', '{{squaresX}} × {{squaresY}} squares', '{{mm}} mm', 'v{{version}}', 'CMYK - PRINT AS SUPPLIED'],
    originInstructionsTitle: 'Instructions',
    /**
     * Instructions column of the origin banner (wrapped when laid out), with `{{measure}}` replaced by
     * {@link originMeasureChart} on a single-sheet chart or {@link originMeasureGuide} on the assembly guide.
     */
    originInstructionsBody: `Print at 1:1 or 100% scale. In the print dialog, disable "Fit to page", "Shrink to fit", and any similar scaling.
{{measure}}
Curvature will affect camera calibration — mount the chart flat on a rigid board so it cannot bend or flop.
For instructions on how to use the chart, buy a pre-made one, or print another, scan the QR code in the top corner.`,
    originMeasureChart: 'Measure a black square with a ruler to ensure the printed size matches the "Square length" in the chart to the right.',
    originMeasureGuide: 'Measure a black square on a chart page (not the reduced chart below) with a ruler to ensure the printed size matches the "Square length" to the right.',
    /**
     * ChArUco metadata beside the QR code: a bold title, body lines (wrapped), then the write-in line,
     * `before`, the empty box the user writes their measured square length in, then `after`; it is never
     * wrapped.
     */
    originChartInfo: {
        title: 'ChArUco calibration chart v{{version}}',
        lines: ['Size: {{squaresX}} x {{squaresY}} (X x Y)', 'Square length: {{mm}} mm'],
        writeIn: {before: 'Measured square length:', after: 'mm'},
    },
} as const;
