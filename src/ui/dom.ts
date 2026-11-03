/** Element lookup and the page's error banner, shared by the UI modules. */
export function byId(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) {
        throw new Error(`Missing #${id}`);
    }
    return el;
}

export function showErr(msg: string | null): void {
    const el = byId('errBanner');
    if (msg) {
        el.classList.remove('hidden');
        el.textContent = msg;
    } else {
        el.classList.add('hidden');
        el.textContent = '';
    }
}
