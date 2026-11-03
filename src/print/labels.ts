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
     * Instructions column of a single-sheet chart's banner (wrapped when laid out). Its height is
     * reserved by tiling, so rerun `npm run generate:banner` after changing it.
     */
    originInstructionsBody: `Print at 1:1 or 100% scale. In the print dialog, disable "Fit to page", "Shrink to fit", and any similar scaling.
Measure a black square with a ruler to ensure the printed size matches the "Square length" in the chart to the right.
Curvature will affect camera calibration — mount the chart flat on a rigid board so it cannot bend or flop.
For instructions on how to use the chart, buy a pre-made one, or print another, scan the QR code in the top corner.`,
    /** Instructions column of the banner on a multi-sheet chart's assembly guide. */
    originInstructionsBodyGuide: `Print at 1:1 or 100% scale. In the print dialog, disable "Fit to page", "Shrink to fit", and any similar scaling.
Measure a black square on a chart page (not the reduced chart below) with a ruler to ensure the printed size matches the "Square length" to the right.
Curvature will affect camera calibration — mount the chart flat on a rigid board so it cannot bend or flop.
For instructions on how to use the chart, buy a pre-made one, or print another, scan the QR code in the top corner.`,
    /**
     * Single multi-line block for ChArUco metadata beside the QR code. First line is rendered bold;
     * remaining lines are wrapped as body text (see {@link originChartInfoParts}). `{{box}}` marks the
     * empty box the user writes their measured square length in; its line is never wrapped.
     */
    originChartInfo: `ChArUco calibration chart v{{version}}
Size: {{squaresX}} x {{squaresY}} (X x Y)
Square length: {{mm}} mm
Measured square length: {{box}} mm`,
} as const;

/** Stands in for the write-in box in {@link originChartInfoParts}' body lines. */
export const ORIGIN_WRITE_IN_BOX_MARK = String.fromCharCode(0xfffc);

export type OriginChartInfoVars = {
    version: string | number;
    mm: string | number;
    squaresX: string | number;
    squaresY: string | number;
};

/** First line → bold title; rest → wrapped detail lines on the sheet banner. */
export function originChartInfoParts(vars: OriginChartInfoVars): {titleLine: string; bodyBlock: string} {
    const full = interpolate(pdfLabels.originChartInfo, {...vars, box: ORIGIN_WRITE_IN_BOX_MARK});
    const idx = full.indexOf('\n');
    if (idx === -1) {
        return {titleLine: full, bodyBlock: ''};
    }
    return {titleLine: full.slice(0, idx), bodyBlock: full.slice(idx + 1)};
}
