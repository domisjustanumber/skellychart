export const MAX_PREVIEW_PAGES = 36;
export const PREVIEW_DEBOUNCE_MS = 320;

export function svgToDataUrl(svg: string): string {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
