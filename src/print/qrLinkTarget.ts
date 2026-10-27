/**
 * Base URL chart QR codes encode.
 *
 * Release builds always use {@link PRODUCTION_PRINT_SOURCE_URL} (CI additionally pins
 * `VITE_CHARUCO_PRINT_SOURCE_URL`, which still takes precedence in `constants.ts`).
 * `npm run dev` defaults to the same production URL so previews, printouts, and exported
 * SVGs look exactly like release output; a dev-only switch can point QR links at the local
 * dev server instead, which is useful for testing query-parameter handling end to end.
 */

export type QrLinkTarget = 'production' | 'local';

const STORAGE_KEY = 'skellychart-qr-link-target';

/** Short link printed QR codes open (GitHub Pages deploy). */
export const PRODUCTION_PRINT_SOURCE_URL = 'https://skelly.cam/c/';

/** In-memory fallback when storage is blocked (private mode); survives the page session. */
let sessionTarget: QrLinkTarget | null = null;

/** Vite replaces this at dev/build time; `null` in release builds. Read via `typeof` for tsx scripts. */
function devLanIp(): string | null {
    return typeof __DEV_LAN_IP__ === 'string' && __DEV_LAN_IP__.length > 0 ? __DEV_LAN_IP__ : null;
}

/**
 * True only in a browser on the dev server. The `typeof` guards keep the print modules
 * importable from Node/tsx (e.g. `scripts/check-app-version.ts`) where neither exists.
 */
export function isQrLinkTargetSwitchAvailable(): boolean {
    return (
        typeof import.meta.env !== 'undefined' &&
        import.meta.env.DEV === true &&
        typeof window !== 'undefined'
    );
}

export function getQrLinkTarget(): QrLinkTarget {
    if (!isQrLinkTargetSwitchAvailable()) {
        return 'production';
    }
    if (sessionTarget !== null) {
        return sessionTarget;
    }
    try {
        return localStorage.getItem(STORAGE_KEY) === 'local' ? 'local' : 'production';
    } catch {
        return 'production';
    }
}

export function setQrLinkTarget(target: QrLinkTarget): void {
    if (!isQrLinkTargetSwitchAvailable()) {
        return;
    }
    sessionTarget = target;
    try {
        if (target === 'local') {
            localStorage.setItem(STORAGE_KEY, 'local');
        } else {
            localStorage.removeItem(STORAGE_KEY);
        }
    } catch {
        // Storage blocked: the in-memory value still applies for this page.
    }
}

function isLoopbackHost(hostname: string): boolean {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

/**
 * URL that reaches this dev server from other devices on the LAN. When the page was opened
 * through `localhost`, substitute the machine's LAN IPv4 (`__DEV_LAN_IP__`, injected by
 * `vite.config.ts`); `server.host: true` makes that address reachable from phones.
 */
function localDevQrSourceUrl(): string {
    const {protocol, hostname, port} = window.location;
    const host = isLoopbackHost(hostname) ? (devLanIp() ?? hostname) : hostname;
    return `${protocol}//${host}${port ? `:${port}` : ''}/`;
}

/** Base URL QR codes should encode right now (the packed chart query is appended later). */
export function resolveQrLinkSourceUrl(): string {
    if (isQrLinkTargetSwitchAvailable() && getQrLinkTarget() === 'local') {
        return localDevQrSourceUrl();
    }
    return PRODUCTION_PRINT_SOURCE_URL;
}
