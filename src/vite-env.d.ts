/// <reference types="vite/client" />

/**
 * Set by Vite's `define` in `vite.config.ts` — substituted in builds, assigned to
 * `globalThis` in dev. See `src/appVersion.ts`.
 */
declare const __APP_VERSION__: string;

/**
 * Dev-server LAN IPv4 (or `null` in builds), injected by Vite's `define` in `vite.config.ts`.
 * Lets the dev-only “local” QR link target encode a phone-reachable URL even when the page
 * was opened through `localhost`. Read through a `typeof` guard (see `src/print/qrLinkTarget.ts`).
 */
declare const __DEV_LAN_IP__: string | null;

interface ImportMetaEnv {
    /** Set in GitHub Actions so printed-chart QR codes point at this repo's GitHub Pages site. */
    readonly VITE_CHARUCO_PRINT_SOURCE_URL?: string;
}
