/** Opt-in timings in Vite dev server only (`npm run dev`). Non-Vite contexts have no `import.meta.env`.
 * Note: `<img>` decode time ≠ full visible paint (composite/GPU may lag); pair with rAF waits in callers.
 */
export function perfDev(): boolean {
    const env = (import.meta as ImportMeta & {env?: {DEV?: boolean}}).env;
    return Boolean(env?.DEV);
}

export function perfLog(label: string, ms: number, detail?: string): void {
    if (!perfDev()) {
        return;
    }
    const extra = detail ? ` — ${detail}` : '';
    console.debug(`[skellychart perf] ${label}: ${ms.toFixed(1)} ms${extra}`);
}

export function perfSync<T>(label: string, fn: () => T): T {
    if (!perfDev()) {
        return fn();
    }
    const t0 = performance.now();
    try {
        return fn();
    } finally {
        perfLog(label, performance.now() - t0);
    }
}

export async function perfAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (!perfDev()) {
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
    if (!perfDev()) {
        return;
    }
    console.debug(`[skellychart perf] ${label}: ${detail}`);
}
