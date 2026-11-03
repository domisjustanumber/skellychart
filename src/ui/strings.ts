/** English UI copy aligned with freemocap `en-english.json` → `charucoPrint`. */

import {DEFAULT_WORKING_DISTANCE, type WorkingDistanceTierId} from '../print/charucoLayout.js';
import type {Paper, PaperId} from '../print/papers.js';
import {mmToInchString} from '../print/svgUtils.js';

/** FreeMoCap multi-camera calibration (using the chart). */
export const FREEMOCAP_CALIBRATION_DOCS_MULTI_CAM_URL =
    'https://docs.freemocap.org/documentation/multi-camera-calibration.html#setting-up-cameras';

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function interpolate(template: string, vars: Record<string, string | number>): string {
    return template.replace(PLACEHOLDER, (_, key: string) =>
        key in vars ? String(vars[key as keyof typeof vars]) : `{{${key}}}`,
    );
}

/** Paper size line in the paper dropdown, in the paper's units: `8.5 × 11 in`, `210 × 297 mm`. */
export function paperOptionDimensions(p: Paper): string {
    return p.units === 'in' ? `${mmToInchString(p.wMm)} × ${mmToInchString(p.hMm)} in` : `${p.wMm} × ${p.hMm} mm`;
}

export const S = {
    /** Theme toggle (header) */
    colorTheme: 'Colour theme',
    themeDark: 'Dark',
    themeLight: 'Light',
    themeSystem: 'System',
    title: 'FreeMoCap Calibration Chart Generator',
    introMain:
        'Create a printable calibration chart that can be used with FreeMoCap. Scan the QR code in the top corner to bring you back here with all of the settings pre-configured.',
    introDocsPrefix: ' ',
    introDocsLinkLabel: 'How to use these charts in FreeMoCap',
    introDocsSuffix: '.',
    workingDistance: 'How far will your subject be from the camera?',
    paperSize: 'Paper size',
    paperOption: '{{paper}} ({{dims}})',
    advanced: 'Advanced settings',
    squareLengthHeading: 'Square length ({{mm}} mm)',
    sheetsOfPaper: 'Sheets of paper',
    pagesStepSquares: '{{mm}} mm squares',
    pagesFewerAria: '{{change}} fewer ({{total}} in all), {{mm}} mm squares',
    pagesMoreAria: '{{change}} more ({{total}} in all), {{mm}} mm squares',
    pagesFewerNone: 'Fewer sheets',
    pagesMoreNone: 'More sheets',
    pagesDetail: '{{cols}}×{{rows}} sheets + assembly guide · chart {{w}} × {{h}} {{unit}}',
    pagesDetailOne: 'chart {{w}} × {{h}} {{unit}}',
    pagesFewestHint:
        'Fewest sheets for {{distance}}: squares must be at least {{mm}} mm. Use fewer squares or larger paper to go lower.',
    pagesFewestGridHint: 'This grid needs at least {{sheets}} on this paper. Use fewer squares or larger paper to go lower.',
    pagesMostOnePerSheetHint: 'One square per sheet: the most this grid can use.',
    squaresInX: 'Squares in X ({{n}})',
    squaresInY: 'Squares in Y ({{n}})',
    layoutCannotFit:
        'Cannot fit this combination — try another square length, number of sheets, or grid.',
    printSave: 'Print & Save',
    printCharts: 'Print',
    savePdfFiles: 'Save as PDF',
    printAdviceShopLead: 'For best results',
    printAdviceShop:
        ', choose Print shop above to make a print-ready file, and have a local print shop print it onto foam board or other rigid material. Their printers are (generally!) calibrated to do 100% accurate scaling and a rigid board that doesn’t bend will give best results.',
    shopAdviceLead: 'Order it on rigid board, matte with no lamination:',
    shopAdviceFinish: ' gloss lamination causes glare that can hide squares from the cameras.',
    shopAdviceSubstrate:
        'Use 5 mm (3/16 in) foam board up to A1 or 24 × 36 in, and 10 mm honeycomb board or 3 mm ACM for bigger boards, where foam flexes. Coroplast is cheaper and works, but is less flat.',
    shopAdviceProducts:
        'FedEx Office: Poster + Foam Board, matte, no lamination (same day). Staples or Office Depot (US): direct-print foam board (delivered). Staples (Canada): foam-core-mounted matte poster. Officeworks: board-mounted poster on 160 gsm coated paper. Avoid mounted posters that force gloss lamination.',
    shopAdviceTemplate:
        'Ordering online? Match the product template’s page size to this file exactly and never use a fit or fill option, or the squares will be scaled.',
    shopAdviceCropMarks: 'If your shop trims by hand to crop marks, turn on Crop marks.',
    shopOrderTitle: 'Order details for the shop',
    shopOrderCopy: 'Copy order details',
    shopOrderCopied: 'Copied.',
    shopOrderCopyManual: 'Selected: press Ctrl+C (⌘C on a Mac) to copy.',
    shopOrderChart: 'FreeMoCap ChArUco calibration board: {{squaresX}} × {{squaresY}} squares, {{mm}} mm each.',
    shopOrderScale: 'Print at 100% (actual size). No scaling, fit or fill.',
    shopOrderPage: 'File is {{page}} = {{trim}} trim + {{bleed}} bleed. Match the product template’s page size exactly; never use a fit or fill option.',
    shopOrderPageExact: 'No bleed; final size {{trim}}. Match the product template’s page size exactly; never use a fit or fill option.',
    shopOrderPageMarks: 'File is {{page}}, with crop marks. Trim to {{trim}} at the crop marks ({{bleed}}).',
    shopOrderBleedIncluded: '{{bleed}} bleed included',
    shopOrderNoBleed: 'no bleed',
    shopOrderBoardSmall: 'Board: 5 mm (3/16 in) foam board, matte, no lamination. Coroplast is acceptable, not ideal.',
    shopOrderBoardLarge: 'Board: 10 mm honeycomb board or 3 mm ACM (5 mm foam flexes at this size), matte, no lamination.',
    shopOrderColour:
        'Colour: CMYK. Squares are C60 K100; text, QR and marks are K100 only. Print as supplied; do not convert colours or turn K100 into rich black.',
    shopOrderCheck: 'On delivery, measure {{n}} squares from an edge to the same edge {{n}} squares along: it should be {{total}} mm ({{mm}} mm each).',
    scanCardTitle: 'You scanned a FreeMoCap calibration chart: {{squaresX}} × {{squaresY}} squares, {{mm}} mm.',
    scanCardMeasure:
        'Measure across as many squares as your ruler spans (at least 2), from an edge to the same edge, divide by the count, and write the result in the box on the chart.',
    scanCardFlat: 'Keep the board flat and out of direct sun.',
    scanCardDocs: 'How to calibrate your cameras with it',
    scanCardPrintAnother: 'Print another',
    scanCardOrder: 'Order from a print shop',
    scanCardDismiss: 'Dismiss',
    printAdviceHomeBody:
        'Home printers often are not accurate even at 1:1 / 100% scale settings, so measure the black box size after printing and write the actual size on the chart for you to remember later.',
    printAdviceHomeEmphasis:
        'If printing at home, use 1:1 or 100% scaling and measure the black square sizes after printing!',
    preparingPrint: 'Preparing print…',
    /** The Save button while a PDF is being made: clicking it cancels the export. */
    cancelPdfExport: 'Cancel (preparing PDF…)',
    cancelPdfExportPage: 'Cancel (PDF page {{current}} of {{total}})',
    printInitFailed: 'Could not prepare printing in this browser. Try refreshing the page.',
    qrChartNewer:
        'This chart was made by a newer version (v={{theirs}}) than this generator (v={{ours}}). The sheet layout or labels may not match what FreeMoCap produced.',
    qrSquareSnapped:
        'This link’s square length ({{theirs}} mm) cannot print on {{paper}}, so the nearest size that can ({{ours}} mm) is shown. Check the square size on your printed chart.',
    qrGridClamped:
        'This link’s board ({{theirs}} squares) needs more ArUco markers than the dictionary holds ({{markers}}), so its markers cannot be detected; the largest board that fits ({{ours}}) is shown instead.',
    printWith: 'Print with',
    modeHome: 'My printer',
    modeShop: 'Print shop',
    shopModeNoFit:
        'This chart is too large for a print-shop board (at most 36 × 48 in). Use fewer or smaller squares, then switch to Print shop.',
    shopModeSnapped: 'Squares shrank from {{from}} mm to {{to}} mm so the chart fits a print-shop board.',
    homeModeSnapped:
        'Squares shrank from {{from}} mm to {{to}} mm, the largest {{paper}} prints. Switch back to Print shop to return to {{from}} mm.',
    shopSize: 'Board size',
    shopUnits: 'Units',
    shopSizeGroupIn: 'Inch sizes',
    shopSizeGroupMm: 'Metric sizes',
    shopSizeTooSmall: '{{size}} (too small for this grid)',
    shopSizeDetail: 'Trim {{trim}} · chart {{w}} × {{h}} {{unit}}',
    shopSizeBandHint: 'Too small for {{distance}}: on {{size}}, squares stop at {{mm}} mm. Choose a larger size.',
    shopCapNote:
        'Print-shop boards are limited to 36 in (914 mm) wide, the largest size most walk-in print shops (FedEx Office, Staples, Office Depot, Officeworks) print on rigid board. Larger boards need a sign shop; support for them may come later.',
    shopBleed: 'Bleed',
    shopBleedStd: 'Standard ({{bleed}})',
    shopBleedNone: 'None (exact trim)',
    shopBleed5: '5 mm (Officeworks mounted posters)',
    shopBleed10: '10 mm (Officeworks corflute, PVC, ACM)',
    shopBleedQuarter: '¼ in (6.35 mm)',
    shopBleedOther: '{{bleed}} (for {{unit}} templates)',
    shopPageSize: 'File {{page}} = {{trim}} trim + {{extras}}',
    shopPageBleed: '{{bleed}} bleed',
    shopPageMarks: 'crop-mark margin',
    shopPageSizeExact: 'File {{page}}: exact trim, no bleed',
    shopCropMarks: 'Crop marks (trade printers that trim)',
    shopSummary: '1 board, trimmed to {{trim}}, {{orientation}}; {{squaresX}}×{{squaresY}} squares; {{mm}} mm square length',
    landscape: 'landscape',
    portrait: 'portrait',
    shopDownload: 'Download print-ready PDF',
    shopTestBuildConfirm:
        'This is a test build (v{{version}}): the QR code on this board will not open the released generator. Make the file anyway (test only)?',
    shopReleaseOnly: 'Print-shop files can only be made from the released generator at skelly.cam.',
    qrShopSizeFallback:
        'This link’s board size could not be read, so the smallest standard size that fits ({{size}}) is shown.',
    qrShopSizeNoFit: 'This board no longer fits {{theirs}}, so {{ours}} is shown.',
    qrShopOptionsFallback:
        'This link’s print-file options could not be read, so the defaults (standard bleed, no crop marks) are shown.',
    qrShopTooLarge: 'This chart is too large for any print-shop board, so it is shown for your own printer.',
    previewTitle: 'Preview',
    fullChartHint:
        'The assembly guide prints first: its numbered, colour-coded blocks show how each printed sheet maps onto the full chart. Print every sheet, cut away the dashed seam lines, then butt the matching numbered edges together in order. Instructions are also on the printed chart.',
    loadingPreviews: 'Loading previews',
    truncatedPreview:
        'Showing first {{shown}} of {{total}} sheets in the preview. Use Print or Save as PDF to output every sheet.',
    pageLabel: 'Page {{n}}',
    heightCm: '{{cm}} cm',
    heightFtIn: '{{ft}}′ {{in}}″',
    scaleSceneAria: 'To scale: the chart, {{w}} × {{h}} {{unit}}, in front of a {{tall}} person and a {{short}} person.',
    scaleSceneAriaSheet:
        'To scale: the printed sheet, {{w}} × {{h}} {{unit}}, in front of a {{tall}} person and a {{short}} person.',
    scaleSceneAriaNoChart: 'To scale: a {{tall}} person and a {{short}} person.',
    assemblyGuideLabel: 'Assembly guide',
    close: '1 - 2m',
    near: '2 - 4m',
    far: '4m +',
    closeFt: '<7 ft',
    nearFt: '7 - 13 ft',
    farFt: '13 ft+',
    /** Paper names in the dropdown; the sheet header uses shorter ones (`pdfLabels.sheetHeaderPaper`). */
    paper: {
        a4: 'A4',
        letter: 'US Letter',
        tabloid: 'Tabloid / Ledger',
        a3: 'A3',
    } satisfies Record<PaperId, string>,
    /** Appended to the 2–4 m working-distance preset in the dropdown only (not band labels). */
    recommendedPreset: '(recommended)',
} as const;

const DISTANCE_LABELS: Record<WorkingDistanceTierId, {metric: string; imperial: string}> = {
    close: {metric: S.close, imperial: S.closeFt},
    near: {metric: S.near, imperial: S.nearFt},
    far: {metric: S.far, imperial: S.farFt},
};

export function distanceLabel(id: WorkingDistanceTierId, imperial: boolean): string {
    const labels = DISTANCE_LABELS[id];
    return imperial ? labels.imperial : labels.metric;
}

/** Dropdown option text — includes markers such as `(recommended)` where applicable. */
export function distanceSelectLabel(id: WorkingDistanceTierId, imperial: boolean): string {
    const base = distanceLabel(id, imperial);
    return id === DEFAULT_WORKING_DISTANCE ? `${base} ${S.recommendedPreset}` : base;
}

export function sheetCountPhrase(count: number): string {
    return count === 1 ? `${count} sheet of paper` : `${count} sheets of paper`;
}

/** Short count for the sheets stepper: “1 sheet”, “6 sheets”. */
export function sheetsShort(count: number): string {
    return count === 1 ? '1 sheet' : `${count} sheets`;
}

export function paperLabel(id: PaperId): string {
    return S.paper[id];
}
