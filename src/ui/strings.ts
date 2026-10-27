/** English UI copy aligned with freemocap `en-english.json` → `charucoPrint`. */

import type {WorkingDistanceTierId} from '../print/charucoLayout.js';

/** FreeMoCap multi-camera calibration (using the chart). */
export const FREEMOCAP_CALIBRATION_DOCS_MULTI_CAM_URL =
    'https://docs.freemocap.org/documentation/multi-camera-calibration.html#setting-up-cameras';

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function interpolate(template: string, vars: Record<string, string | number>): string {
    return template.replace(PLACEHOLDER, (_, key: string) =>
        key in vars ? String(vars[key as keyof typeof vars]) : `{{${key}}}`,
    );
}

/** Paper size line in the paper dropdown: US formats in inches, ISO in mm. */
export function paperOptionDimensions(id: string, wMm: number, hMm: number): string {
    switch (id) {
        case 'letter':
            return '8.5 × 11 in';
        case 'tabloid':
            return '11 × 17 in';
        default:
            return `${wMm} × ${hMm} mm`;
    }
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
    pagesFewerAria: 'Fewer sheets: {{sheets}}, {{mm}} millimetre squares',
    pagesMoreAria: 'More sheets: {{sheets}}, {{mm}} millimetre squares',
    pagesFewerNone: 'Fewer sheets',
    pagesMoreNone: 'More sheets',
    pagesDetail: '{{cols}}×{{rows}} sheets · chart {{w}} × {{h}} {{unit}}',
    pagesDetailOne: 'chart {{w}} × {{h}} {{unit}}',
    pagesFewestHint:
        'Fewest sheets for {{distance}}: squares must be at least {{mm}} mm. Use fewer squares or larger paper to go lower.',
    pagesMostOnePerSheetHint: 'One square per sheet: the most this grid can use.',
    pagesMostLargestHint: 'Largest square that prints on this paper ({{mm}} mm).',
    squaresInX: 'Squares in X ({{n}})',
    squaresInY: 'Squares in Y ({{n}})',
    layoutCannotFit:
        'Cannot fit this combination — try another square length, number of sheets, or grid.',
    printSave: 'Print & Save',
    printCharts: 'Print',
    savePdfFiles: 'Save as PDF',
    printAdviceShopLead: 'For best results',
    printAdviceShop:
        ', ask your local print shop to print this onto foam core or other rigid material. Their printers are (generally!) calibrated to do 100% accurate scaling and a rigid board that doesn’t bend will give best results.',
    printAdviceHomeBody:
        'Home printers often are not accurate even at 1:1 / 100% scale settings, so measure the black box size after printing and write the actual size on the chart for you to remember later.',
    printAdviceHomeEmphasis:
        'If printing at home, use 1:1 or 100% scaling and measure the black square sizes after printing!',
    preparingPrint: 'Preparing print…',
    preparingPdfExport: 'Preparing PDF…',
    preparingPdfPage: 'Preparing PDF… ({{current}}/{{total}})',
    printInitFailed: 'Could not prepare printing in this browser. Try refreshing the page.',
    qrChartNewer:
        'This chart was made by a newer version (v={{theirs}}) than this generator (v={{ours}}). The sheet layout or labels may not match what FreeMoCap produced.',
    qrSquareSnapped:
        'This link’s square length ({{theirs}} mm) cannot print on {{paper}}, so the nearest size that can ({{ours}} mm) is shown. Check the square size on your printed chart.',
    qrOpenCvMismatch:
        'This link’s OpenCV line (cv2) does not match this generator (expected {{ours}}; got {{theirs}}). Board detection or geometry may differ.',
    previewTitle: 'Preview',
    fullChart: 'Full ChArUco pattern',
    fullChartHint:
        'The numbered, colour-coded blocks show how each printed sheet maps onto the full chart. Print every sheet, cut away the dashed seam lines, then butt the matching numbered edges together in order. Instructions are also on the printed chart.',
    loadingPreview: 'Loading preview',
    loadingPreviews: 'Loading previews',
    truncatedPreview:
        'Showing first {{shown}} of {{total}} pages in the preview. Use Print or Save as PDF to output every sheet.',
    pageLabel: 'Page {{n}}',
    pageBlockLabel: 'Page {{n}} of {{total}}',
    close: '1 - 2m',
    near: '2 - 4m',
    far: '4m +',
    closeFt: '<7 ft',
    nearFt: '7 - 13 ft',
    farFt: '13 ft+',
    paper: {
        a4: 'A4',
        letter: 'US Letter',
        tabloid: 'Tabloid / Ledger',
        a3: 'A3',
    },
    /** Appended to the 2–4 m working-distance preset in the dropdown only (not band labels). */
    recommendedPreset: '(recommended)',
} as const;

export function distanceLabel(id: string, imperial: boolean): string {
    if (imperial) {
        switch (id) {
            case 'close':
                return S.closeFt;
            case 'near':
                return S.nearFt;
            case 'far':
                return S.farFt;
            default:
                return id;
        }
    }
    switch (id) {
        case 'close':
            return S.close;
        case 'near':
            return S.near;
        case 'far':
            return S.far;
        default:
            return id;
    }
}

/** Dropdown option text — includes markers such as `(recommended)` where applicable. */
export function distanceSelectLabel(id: string, imperial: boolean): string {
    const base = distanceLabel(id, imperial);
    return id === 'near' ? `${base} ${S.recommendedPreset}` : base;
}

export function bandLabel(tier: WorkingDistanceTierId, imperial: boolean): string {
    return distanceLabel(tier, imperial);
}

export function sheetCountPhrase(count: number): string {
    return count === 1 ? `${count} sheet of paper` : `${count} sheets of paper`;
}

/** Short count for the sheets stepper: “1 sheet”, “6 sheets”. */
export function sheetsShort(count: number): string {
    return count === 1 ? '1 sheet' : `${count} sheets`;
}

export function paperLabel(id: string): string {
    const p = S.paper[id as keyof typeof S.paper];
    return p ?? id;
}
