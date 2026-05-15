/** Logo asset at `public/freemocap-logo.svg` (same origin as the app). */
function viteBaseUrl(): string {
    const b = (import.meta as ImportMeta & {env?: {BASE_URL?: string}}).env?.BASE_URL;
    return typeof b === 'string' && b.length > 0 ? b : './';
}

export default `${viteBaseUrl()}freemocap-logo.svg`;
