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

export const S = {
    /** Theme toggle (header) */
    colorTheme: 'Colour theme',
    themeDark: 'Dark',
    themeLight: 'Light',
    themeSystem: 'System',
    title: 'FreeMoCap Calibration Chart Generator',
    introMain:
        'Create a printable calibration chart that can be used with FreeMoCap. Select the distance your subject will be from the camera and your paper size. Use the Advanced settings if you want to fine-tune settings.\n\nThe QR code in the top corner can be scanned with your phone to bring you back here with all of the settings pre-configured.',
    introDocsPrefix: '\n\nTo find out how to use the chart, check out the ',
    introDocsLinkLabel: 'FreeMoCap documentation',
    introDocsSuffix: '.',
    workingDistance: 'Working distance from camera',
    paperSize: 'Paper size',
    paperOption: '{{paper}} ({{wMm}} × {{hMm}} mm)',
    advanced: 'Advanced',
    squareLengthHeading: 'Square length ({{mm}} mm)',
    numberOfPages: 'Number of pages ({{n}})',
    squaresInX: 'Squares in X ({{n}})',
    squaresInY: 'Squares in Y ({{n}})',
    layoutCannotFit:
        'Cannot fit this combination — try another square length, number of sheets, or grid.',
    printCharts: 'Print',
    saveSvgFiles: 'Save SVG files',
    printScaleHint: 'Ensure you print at 1:1 or 100% scaling!',
    preparingPrint: 'Preparing print…',
    preparingSvgExport: 'Preparing SVG…',
    printInitFailed: 'Could not prepare printing in this browser. Try refreshing the page.',
    qrChartSpecMismatch:
        'This link’s chart metadata version (v={{theirs}}) does not match this generator (v={{ours}}). The sheet layout or labels may not match what FreeMoCap produced.',
    qrOpenCvMismatch:
        'This link’s OpenCV line (cv2) does not match this generator (expected {{ours}}; got {{theirs}}). Board detection or geometry may differ.',
    previewTitle: 'Preview',
    fullChart: 'Full ChArUco pattern',
    loadingPreview: 'Loading preview',
    loadingPreviews: 'Loading previews',
    truncatedPreview:
        'Showing first {{shown}} of {{total}} pages in the preview. Use Print to output every sheet.',
    pageCountLabel: '{{count}} pages',
    pageLabel: 'Page {{n}}',
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

export function paperLabel(id: string): string {
    const p = S.paper[id as keyof typeof S.paper];
    return p ?? id;
}
