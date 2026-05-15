/**
 * Shared preset bake logic (used by the CLI and worker threads).
 */
import {createCanvas, Image} from '@napi-rs/canvas';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {renderCharucoBoardSvg} from '../src/charuco/board.js';
import {CHARUCO_MARKER_LENGTH_RATIO} from '../src/print/constants.js';
import {
    PAPER_OPTIONS,
    computeEffectiveTiling,
    maxSquareMmForGridAndPages,
    paperById,
    resolveDistancePrintPlan,
} from '../src/print/charucoLayout.js';
import {buildPageSpecs, nominalPaperToPdfDimensionsMm} from '../src/print/tiling.js';
import type {PresetPreviewManifestEntry} from '../src/ui/presetPreviewManifest.js';
import {MAX_PREVIEW_PAGES} from '../src/ui/previewSvg.js';

export const PRESET_IDS = ['near', 'mid', 'far'] as const;

export type DistanceId = (typeof PRESET_IDS)[number];
export type PaperOption = (typeof PAPER_OPTIONS)[number];

export const PREVIEW_MAX_PX_WIDTH = 130;
export const PREVIEW_MAX_SCALE = 0.44;

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

type RenderCharucoPrintSvgZip = typeof import('../src/print/svgDocument.js').renderCharucoPrintSvgZip;
type RenderCharucoPrintSvg = typeof import('../src/print/svgDocument.js').renderCharucoPrintSvg;

export async function bakeOnePreset(
    distanceId: DistanceId,
    paper: PaperOption,
    outDir: string,
    renderZip: RenderCharucoPrintSvgZip,
    renderSvg: RenderCharucoPrintSvg,
): Promise<{key: string; entry: PresetPreviewManifestEntry}> {
    const key = `${distanceId}:${paper.id}`;
    mkdirSync(join(outDir, distanceId, paper.id), {recursive: true});

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
    const markerMm = squareMm * CHARUCO_MARKER_LENGTH_RATIO;
    const boardSvg = renderCharucoBoardSvg(cW, cH, {
        squaresX,
        squaresY,
        squareLength: squareMm,
        markerLength: markerMm,
    });
    const boardRel = `${distanceId}/${paper.id}/board.svg`;
    writeFileSync(join(outDir, boardRel), boardSvg, 'utf8');

    const {paperWMm, paperHMm} = nominalPaperToPdfDimensionsMm(paperRecord.wMm, paperRecord.hMm, tiling);
    const pages = buildPageSpecs(squaresX, squaresY, tiling).pages;

    const printParams = {
        squaresX,
        squaresY,
        squareLengthMm: squareMm,
        paperWMm,
        paperHMm,
        markerLengthRatio: CHARUCO_MARKER_LENGTH_RATIO,
        tiling,
        pages,
    };

    const zipBlob = await renderZip(printParams);
    const zipRel = `${distanceId}/${paper.id}/chart.zip`;
    writeFileSync(join(outDir, zipRel), Buffer.from(await zipBlob.arrayBuffer()));

    const {pages: pageSvgs, totalPages} = await renderSvg(printParams);
    const thumbPaths: string[] = [];
    const n = Math.min(pageSvgs.length, MAX_PREVIEW_PAGES);
    for (let i = 0; i < n; i++) {
        const rel = `${distanceId}/${paper.id}/p${i}.svg`;
        writeFileSync(join(outDir, rel), pageSvgs[i]!, 'utf8');
        thumbPaths.push(rel);
    }

    return {
        key,
        entry: {
            board: boardRel,
            thumbs: thumbPaths,
            chartZip: zipRel,
            totalPages,
            truncated: totalPages > MAX_PREVIEW_PAGES,
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

export function bakeLogoEnv(root: string): void {
    const logoPath = join(root, 'public', 'freemocap-logo.svg');
    process.env.CHARUCO_LOGO_FILE = logoPath;
}
