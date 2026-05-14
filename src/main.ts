import {putGrayOnCanvas, renderCharucoBoardGray} from './charuco/board.js';
import {PAPER_SIZES_MM} from './print/constants.js';
import {renderCharucoPrintPdf} from './print/pdfDocument.js';
import {buildPageSpecs, computeTilingInfo, selectPaperDimensionsMm} from './print/tiling.js';

const $ = (id: string) => document.getElementById(id)!;

function readParams() {
    const squaresX = Math.max(2, Math.min(32, Number(($('sx') as HTMLInputElement).value) || 4));
    const squaresY = Math.max(2, Math.min(32, Number(($('sy') as HTMLInputElement).value) || 5));
    const squareLengthMm = Math.max(10, Math.min(250, Number(($('sqmm') as HTMLInputElement).value) || 58));
    const markerLengthRatio = Math.max(0.1, Math.min(0.99, Number(($('ratio') as HTMLInputElement).value) || 0.8));
    const legacyPattern = ($('legacy') as HTMLInputElement).checked;
    const paperId = ($('paper') as HTMLSelectElement).value;
    return {squaresX, squaresY, squareLengthMm, markerLengthRatio, legacyPattern, paperId};
}

function showErr(msg: string | null): void {
    const el = $('err') as HTMLParagraphElement;
    if (msg) {
        el.hidden = false;
        el.textContent = msg;
    } else {
        el.hidden = true;
        el.textContent = '';
    }
}

function updatePreview(): void {
    showErr(null);
    const {squaresX, squaresY, squareLengthMm, markerLengthRatio, legacyPattern, paperId} = readParams();
    const markerMm = squareLengthMm * markerLengthRatio;
    const canvas = $('board') as HTMLCanvasElement;
    const maxEdge = 920;
    const wMm = squaresX * squareLengthMm;
    const hMm = squaresY * squareLengthMm;
    let cW: number;
    let cH: number;
    if (wMm >= hMm) {
        cW = Math.min(maxEdge, Math.max(32, Math.round(wMm)));
        cH = Math.max(1, Math.round(cW * (hMm / wMm)));
    } else {
        cH = Math.min(maxEdge, Math.max(32, Math.round(hMm)));
        cW = Math.max(1, Math.round(cH * (wMm / hMm)));
    }
    canvas.width = cW;
    canvas.height = cH;
    const gray = renderCharucoBoardGray(cW, cH, {
        squaresX,
        squaresY,
        squareLength: squareLengthMm,
        markerLength: markerMm,
        legacyPattern,
    });
    putGrayOnCanvas(canvas, gray);

    const nom = PAPER_SIZES_MM[paperId];
    if (!nom) {
        showErr('Unknown paper.');
        return;
    }
    const [nw, nh] = nom;
    const tilingEl = $('tiling') as HTMLParagraphElement;
    let paperWMm: number;
    let paperHMm: number;
    try {
        ({paperWMm, paperHMm} = selectPaperDimensionsMm(squaresX, squaresY, squareLengthMm, nw, nh, undefined));
    } catch {
        tilingEl.textContent =
            'This board does not fit on the selected paper at 1:1 — try larger paper or smaller squares.';
        return;
    }
    const tiling = computeTilingInfo(squaresX, squaresY, squareLengthMm, paperWMm, paperHMm);
    if (!tiling) {
        tilingEl.textContent = 'Tiling failed for selected paper dimensions.';
        return;
    }
    const orient = paperWMm !== nw || paperHMm !== nh ? ' (auto-oriented)' : '';
    tilingEl.textContent = `Print tiling: ${tiling.pageCount} sheet(s)${orient} at 12 px/mm. Inner grid up to ${tiling.maxCx}×${tiling.maxCyFirst} (row 1) / ${tiling.maxCyRest} (later rows) squares per page.`;
}

async function downloadPng(): Promise<void> {
    showErr(null);
    const {squaresX, squaresY, squareLengthMm, markerLengthRatio, legacyPattern} = readParams();
    const markerMm = squareLengthMm * markerLengthRatio;
    const ppm = 12;
    const wPx = Math.max(1, squaresX * squareLengthMm * ppm);
    const hPx = Math.max(1, squaresY * squareLengthMm * ppm);
    const gray = renderCharucoBoardGray(wPx, hPx, {
        squaresX,
        squaresY,
        squareLength: squareLengthMm,
        markerLength: markerMm,
        legacyPattern,
    });
    const c = document.createElement('canvas');
    c.width = wPx;
    c.height = hPx;
    putGrayOnCanvas(c, gray);
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = `charuco_${squaresX}x${squaresY}_${squareLengthMm}mm.png`;
    a.click();
}

async function downloadPdf(): Promise<void> {
    showErr(null);
    const {squaresX, squaresY, squareLengthMm, markerLengthRatio, legacyPattern, paperId} = readParams();
    const nom = PAPER_SIZES_MM[paperId];
    if (!nom) {
        showErr('Unknown paper.');
        return;
    }
    const [nw, nh] = nom;
    let tiling = computeTilingInfo(squaresX, squaresY, squareLengthMm, nw, nh);
    if (!tiling) {
        showErr('Cannot tile this board on the selected paper.');
        return;
    }
    let paperWMm: number;
    let paperHMm: number;
    try {
        ({paperWMm, paperHMm} = selectPaperDimensionsMm(squaresX, squaresY, squareLengthMm, nw, nh, undefined));
    } catch (e) {
        showErr(e instanceof Error ? e.message : String(e));
        return;
    }

    tiling = computeTilingInfo(squaresX, squaresY, squareLengthMm, paperWMm, paperHMm);
    if (!tiling) {
        showErr('Tiling failed after orientation selection.');
        return;
    }
    const {pages} = buildPageSpecs(squaresX, squaresY, tiling);

    try {
        const blob = await renderCharucoPrintPdf({
            squaresX,
            squaresY,
            squareLengthMm,
            paperWMm,
            paperHMm,
            markerLengthRatio,
            legacyPattern,
            tiling,
            pages,
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `charuco_${squaresX}x${squaresY}_${paperId}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (e) {
        showErr(e instanceof Error ? e.message : String(e));
    }
}

($('preview') as HTMLButtonElement).addEventListener('click', updatePreview);
($('png') as HTMLButtonElement).addEventListener('click', () => void downloadPng());
($('pdf') as HTMLButtonElement).addEventListener('click', () => void downloadPdf());

for (const id of ['sx', 'sy', 'sqmm', 'ratio', 'legacy', 'paper']) {
    $(id).addEventListener('change', updatePreview);
}

updatePreview();
