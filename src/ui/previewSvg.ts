export const MAX_PREVIEW_PAGES = 36;
/** Debounce after the user stops manipulating ranges (keyboard / one-off changes). */
export const PREVIEW_DEBOUNCE_IDLE_MS = 320;
/** Tighter debounce while a range input pointer is active so previews keep up while dragging. */
export const PREVIEW_DEBOUNCE_INTERACTIVE_MS = 96;

export function svgToDataUrl(svg: string): string {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
