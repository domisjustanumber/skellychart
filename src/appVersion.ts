/**
 * Version injected by Vite's `define` at dev/build time (see `vite.config.ts`).
 *
 * `__APP_VERSION__` is declared globally in `vite-env.d.ts`. In a build, Vite's
 * `define` substitutes the literal. In dev, Vite assigns the define onto
 * `globalThis` (via `/@vite/env`), so the bare identifier resolves at runtime.
 *
 * The `typeof` guard is deliberate: tsx scripts import the print modules outside
 * Vite, where the identifier is undeclared. Reading it would throw; `typeof` does not.
 */
export const APP_VERSION: string =
    typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';

/**
 * Printed-banner form of a version: the dev token is title-cased so the sheet reads “vDevelop”
 * (the QR token and URL stay the lowercase `develop`). Release versions pass through.
 */
export function displayAppVersion(version: string): string {
    return version === 'develop' ? 'Develop' : version;
}

/** Printed-banner form of {@link APP_VERSION}. */
export const APP_VERSION_DISPLAY: string = displayAppVersion(APP_VERSION);
