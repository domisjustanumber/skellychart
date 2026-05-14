import * as pdfjs from 'pdfjs-dist';
// Vite resolves worker as URL
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {yieldToMain} from './yieldToMain.js';

let workerConfigured = false;

function ensurePdfWorker(): void {
    if (!workerConfigured) {
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        workerConfigured = true;
    }
}

const PREVIEW_MAX_PX_WIDTH = 130;
const PREVIEW_MAX_SCALE = 0.44;
export const MAX_PREVIEW_PAGES = 36;
export const PREVIEW_DEBOUNCE_MS = 320;

export async function decodePdfThumbnails(
    data: ArrayBuffer,
    signal: AbortSignal,
): Promise<{images: string[]; truncated: boolean; totalPages: number}> {
    ensurePdfWorker();
    const task = pdfjs.getDocument({data: new Uint8Array(data), verbosity: 0});
    signal.addEventListener('abort', () => void task.destroy(), {once: true});
    const pdf = await task.promise;
    try {
        const totalPages = pdf.numPages;
        const n = Math.min(totalPages, MAX_PREVIEW_PAGES);
        const images: string[] = [];
        for (let i = 1; i <= n; i++) {
            signal.throwIfAborted();
            const page = await pdf.getPage(i);
            signal.throwIfAborted();
            const vp0 = page.getViewport({scale: 1});
            const scale = Math.min(PREVIEW_MAX_PX_WIDTH / vp0.width, PREVIEW_MAX_SCALE);
            const viewport = page.getViewport({scale});
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                throw new Error('Canvas is not supported in this environment.');
            }
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            await page.render({canvasContext: ctx, viewport}).promise;
            images.push(canvas.toDataURL('image/jpeg', 0.88));
            await yieldToMain();
        }
        return {images, truncated: totalPages > MAX_PREVIEW_PAGES, totalPages};
    } finally {
        await pdf.destroy().catch(() => undefined);
    }
}
