/** English UI copy aligned with freemocap `en-english.json` → `charucoPrint`. */

import type {WorkingDistanceTierId} from '../print/charucoLayout.js';

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
    intro:
        'Create a printable SVG chart with QR metadata on the first sheet, tape-join labels on interior edges, and a corner marker at the square origin. Margins stay blank for printer grab areas. Pick paper size and working distance; we choose the grid and number of sheets automatically and use the largest square length that fits. Use Advanced to adjust square length or grid size by hand. The square-length slider is colour banded by suggested working distance; when you customise the layout, the distance control follows the current square length.',
    workingDistance: 'Working distance from camera',
    paperSize: 'Paper size',
    paperOption: '{{paper}} ({{wMm}} × {{hMm}} mm)',
    advanced: 'Advanced',
    squareLengthHeading: 'Square length ({{mm}} mm, integer — snaps to valid print tiling)',
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
    fullChart: 'Full ChaRuCo pattern',
    loadingPreview: 'Loading preview',
    loadingPreviews: 'Loading previews',
    truncatedPreview:
        'Showing first {{shown}} of {{total}} pages in the preview. Use Print to output every sheet.',
    pageCountLabel: '{{count}} pages',
    pageLabel: 'Page {{n}}',
    near: '1 - 4m',
    far: '4m +',
    nearFt: '<13 ft',
    farFt: '13 ft+',
    paper: {
        a4: 'A4',
        letter: 'US Letter',
        tabloid: 'Tabloid / Ledger',
        a3: 'A3',
    },
} as const;

export function distanceLabel(id: string, imperial: boolean): string {
    if (imperial) {
        switch (id) {
            case 'near':
                return S.nearFt;
            case 'far':
                return S.farFt;
            default:
                return id;
        }
    }
    switch (id) {
        case 'near':
            return S.near;
        case 'far':
            return S.far;
        default:
            return id;
    }
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
