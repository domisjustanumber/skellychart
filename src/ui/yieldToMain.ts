/** Lets the browser paint and run animations before continuing heavy main-thread work. */
export async function yieldToMain(): Promise<void> {
    const sched = (globalThis as {scheduler?: {yield?: () => Promise<void>}}).scheduler;
    if (typeof sched?.yield === 'function') {
        await sched.yield();
        return;
    }
    if (typeof globalThis.requestAnimationFrame === 'function') {
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
