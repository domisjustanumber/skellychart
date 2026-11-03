/** Opt-in timings in Vite dev server only (`npm run dev`, {@link IS_DEV}).
 * Note: `<img>` decode time ≠ full visible paint (composite/GPU may lag); pair with rAF waits in callers.
 */
import {IS_DEV} from '../env.js';

export function perfLog(label: string, ms: number, detail?: string): void {
    if (!IS_DEV) {
        return;
    }
    const extra = detail ? ` — ${detail}` : '';
    console.debug(`[skellychart perf] ${label}: ${ms.toFixed(1)} ms${extra}`);
}

export async function perfAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (!IS_DEV) {
        return fn();
    }
    const t0 = performance.now();
    try {
        return await fn();
    } finally {
        perfLog(label, performance.now() - t0);
    }
}

export function perfNote(label: string, detail: string): void {
    if (!IS_DEV) {
        return;
    }
    console.debug(`[skellychart perf] ${label}: ${detail}`);
}
