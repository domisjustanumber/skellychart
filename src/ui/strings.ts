/** English UI copy aligned with freemocap `en-english.json` → `charucoPrint`. */

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
    workingDistance: 'Working distance',
    paperSize: 'Paper size',
    paperOption: '{{paper}} ({{wMm}} × {{hMm}} mm)',
    advanced: 'Advanced',
    customGridCaption:
        'Custom layout: changing square length keeps the grid and updates pages; changing X or Y keeps the square length and updates pages; changing page count keeps the grid and picks the largest square length that fits. Pick paper size or working distance again for the automatic preset.',
    autoGridCaption:
        'Square length is the largest size that fits the automatic grid and page count for your distance and paper. Move a slider below to customize; choose paper size or distance again to restore the preset grid and pages.',
    squareLengthHeading: 'Square length ({{mm}} mm, integer — snaps to valid print tiling)',
    numberOfPages: 'Number of pages ({{n}})',
    squaresInX: 'Squares in X ({{n}})',
    squaresInY: 'Squares in Y ({{n}})',
    layoutCannotFit:
        'Cannot fit this combination — try another square length, number of sheets, or grid.',
    downloadSvg: 'Download SVG (ZIP)',
    generatingSvg: 'Generating SVG…',
    previewTitle: 'Preview',
    fullChart: 'Full ChaRuCo pattern',
    buildingPreview: 'Building preview…',
    buildingPreviews: 'Building previews…',
    truncatedPreview:
        'Showing first {{shown}} of {{total}} pages in the preview. Download the ZIP for the full document.',
    pageCountLabel: '{{count}} pages',
    pageLabel: 'Page {{n}}',
    near: '1–2 m',
    mid: '2–4 m (recommended)',
    far: '4 m+',
    nearFt: '3–7 ft',
    midFt: '7–13 ft (recommended)',
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
            case 'mid':
                return S.midFt;
            case 'far':
                return S.farFt;
            default:
                return id;
        }
    }
    switch (id) {
        case 'near':
            return S.near;
        case 'mid':
            return S.mid;
        case 'far':
            return S.far;
        default:
            return id;
    }
}

export function bandLabel(tier: 'near' | 'mid' | 'far', imperial: boolean): string {
    return distanceLabel(tier, imperial);
}

export function sheetCountPhrase(count: number): string {
    return count === 1 ? `${count} sheet of paper` : `${count} sheets of paper`;
}

export function paperLabel(id: string): string {
    const p = S.paper[id as keyof typeof S.paper];
    return p ?? id;
}
