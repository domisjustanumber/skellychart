/**
 * Shared preset bake logic (used by the CLI and worker threads).
 */
import {createCanvas, Image} from '@napi-rs/canvas';
import {mkdirSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import type {PresetPreviewManifestEntry} from '../src/ui/presetPreviewManifest.js';
import {putGrayOnCanvas, renderCharucoBoardGray} from '../src/charuco/board.js';
import {CHARUCO_MARKER_LENGTH_RATIO} from '../src/print/constants.js';
import {
    PAPER_OPTIONS,
    computeEffectiveTiling,
    maxSquareMmForGridAndPages,
    paperById,
    resolveDistancePrintPlan,
} from '../src/print/charucoLayout.js';
import {buildPageSpecs, nominalPaperToPdfDimensionsMm} from '../src/print/tiling.js';

export const PRESET_IDS = ['near', 'mid', 'far'] as const;

export type DistanceId = (typeof PRESET_IDS)[number];
export type PaperOption = (typeof PAPER_OPTIONS)[number];

export const PREVIEW_MAX_PX_WIDTH = 130;
export const PREVIEW_MAX_SCALE = 0.44;
export const MAX_PREVIEW_PAGES = 36;

let pdfWorkerConfigured = false;

function ensurePdfJsWorker(): void {
    if (pdfWorkerConfigured) {
        return;
    }
    const require = createRequire(import.meta.url);
    (pdfjs as typeof pdfjs & {GlobalWorkerOptions: {workerSrc: string}}).GlobalWorkerOptions.workerSrc =
        pathToFileURL(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs')).href;
    pdfWorkerConfigured = true;
}

export function patchDomGlobals(): void {
    const g = globalThis as typeof globalThis & {
        document: {createElement(tag: string): ReturnType<typeof createCanvas>};
        Image: typeof Image;
    };
    g.Image = Image;
    g.document = {
        createElement(tag: string) {
            if (tag !== 'canvas') {
                throw new Error(`bake: unsupported element <${tag}>`);
            }
            return createCanvas(300, 150);
        },
    };
}

export async function pdfToThumbDataUrls(pdfBytes: ArrayBuffer): Promise<{
    images: string[];
    truncated: boolean;
    totalPages: number;
}> {
    ensurePdfJsWorker();
    const task = pdfjs.getDocument({data: new Uint8Array(pdfBytes), verbosity: 0});
    const pdf = await task.promise;
    try {
        const totalPages = pdf.numPages;
        const n = Math.min(totalPages, MAX_PREVIEW_PAGES);
        const images: string[] = new Array(n);
        await Promise.all(
            Array.from({length: n}, async (_, j) => {
                const i = j + 1;
                const page = await pdf.getPage(i);
                const vp0 = page.getViewport({scale: 1});
                const scale = Math.min(PREVIEW_MAX_PX_WIDTH / vp0.width, PREVIEW_MAX_SCALE);
                const viewport = page.getViewport({scale});
                const w = Math.floor(viewport.width);
                const h = Math.floor(viewport.height);
                const canvas = createCanvas(w, h);
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    throw new Error('bake: no 2d context');
                }
                await page.render({
                    canvasContext: ctx as unknown as CanvasRenderingContext2D,
                    viewport,
                    canvas: canvas as unknown as HTMLCanvasElement,
                }).promise;
                const jpegBuf = await canvas.encode('jpeg', 88);
                images[j] = `data:image/jpeg;base64,${jpegBuf.toString('base64')}`;
            }),
        );
        return {images, truncated: totalPages > MAX_PREVIEW_PAGES, totalPages};
    } finally {
        await pdf.destroy().catch(() => undefined);
    }
}

export function presetBoardCanvasSize(squaresX: number, squaresY: number, squareMm: number): {cW: number; cH: number} {
    const maxEdge = 560;
    const wMm = squaresX * squareMm;
    const hMm = squaresY * squareMm;
    let cW: number;
    let cH: number;
    if (wMm >= hMm) {
        cW = Math.min(maxEdge, Math.max(32, Math.round(wMm)));
        cH = Math.max(1, Math.round(cW * (hMm / wMm)));
    } else {
        cH = Math.min(maxEdge, Math.max(32, Math.round(hMm)));
        cW = Math.max(1, Math.round(cH * (wMm / hMm)));
    }
    return {cW, cH};
}

export function listPresetJobs(): {distanceId: DistanceId; paper: PaperOption}[] {
    const jobs: {distanceId: DistanceId; paper: PaperOption}[] = [];
    for (const distanceId of PRESET_IDS) {
        for (const paper of PAPER_OPTIONS) {
            jobs.push({distanceId, paper});
        }
    }
    return jobs;
}

type RenderCharucoPrintPdf = typeof import('../src/print/pdfDocument.js').renderCharucoPrintPdf;

export async function bakeOnePreset(
    distanceId: DistanceId,
    paper: PaperOption,
    outDir: string,
    renderCharucoPrintPdf: RenderCharucoPrintPdf,
): Promise<{key: string; entry: PresetPreviewManifestEntry}> {
    const key = `${distanceId}:${paper.id}`;
    const dir = join(outDir, distanceId, paper.id);
    mkdirSync(dir, {recursive: true});

    const plan = resolveDistancePrintPlan(distanceId, paper.id);
    const paperRecord = paperById(paper.id) ?? paper;
    const maxSq = maxSquareMmForGridAndPages(
        plan.squaresX,
        plan.squaresY,
        paperRecord.wMm,
        paperRecord.hMm,
        plan.targetPages,
    );
    if (maxSq === null) {
        throw new Error(`bake: no valid square for preset ${key}`);
    }
    const squareMm = maxSq;
    const squaresX = plan.squaresX;
    const squaresY = plan.squaresY;

    const tiling = computeEffectiveTiling(squaresX, squaresY, squareMm, paperRecord.wMm, paperRecord.hMm, true, plan.targetPages);
    if (!tiling || tiling.pageCount < 1) {
        throw new Error(`bake: invalid tiling for preset ${key}`);
    }

    const {cW, cH} = presetBoardCanvasSize(squaresX, squaresY, squareMm);
    const previewCanvas = createCanvas(cW, cH);
    const markerMm = squareMm * CHARUCO_MARKER_LENGTH_RATIO;
    const gray = renderCharucoBoardGray(cW, cH, {
        squaresX,
        squaresY,
        squareLength: squareMm,
        markerLength: markerMm,
    });
    putGrayOnCanvas(previewCanvas as unknown as HTMLCanvasElement, gray);
    const boardFile = join(outDir, distanceId, paper.id, 'board.png');
    writeFileSync(boardFile, await previewCanvas.encode('png'));

    const {paperWMm, paperHMm} = nominalPaperToPdfDimensionsMm(paperRecord.wMm, paperRecord.hMm, tiling);
    const pages = buildPageSpecs(squaresX, squaresY, tiling).pages;

    const blob = await renderCharucoPrintPdf({
        squaresX,
        squaresY,
        squareLengthMm: squareMm,
        paperWMm,
        paperHMm,
        markerLengthRatio: CHARUCO_MARKER_LENGTH_RATIO,
        tiling,
        pages,
    });
    const pdfBuf = await blob.arrayBuffer();

    const pdfRel = `${distanceId}/${paper.id}/chart.pdf`;
    writeFileSync(join(outDir, distanceId, paper.id, 'chart.pdf'), Buffer.from(pdfBuf));

    const decoded = await pdfToThumbDataUrls(pdfBuf);
    const thumbPaths: string[] = [];
    decoded.images.forEach((dataUrl, i) => {
        const m = /^data:image\/jpeg;base64,(.+)$/i.exec(dataUrl);
        if (!m?.[1]) {
            throw new Error(`bake: bad jpeg data url for ${key} page ${i + 1}`);
        }
        writeFileSync(join(outDir, distanceId, paper.id, `p${i}.jpg`), Buffer.from(m[1], 'base64'));
        thumbPaths.push(`${distanceId}/${paper.id}/p${i}.jpg`);
    });

    const boardPathRel = `${distanceId}/${paper.id}/board.png`;
    return {
        key,
        entry: {
            board: boardPathRel,
            thumbs: thumbPaths,
            pdf: pdfRel,
            totalPages: decoded.totalPages,
            truncated: decoded.truncated,
        },
    };
}

export async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;

    async function worker(): Promise<void> {
        for (;;) {
            const i = nextIndex++;
            if (i >= items.length) {
                return;
            }
            results[i] = await fn(items[i]!, i);
        }
    }

    const n = Math.max(1, Math.min(concurrency, items.length));
    await Promise.all(Array.from({length: n}, () => worker()));
    return results;
}
