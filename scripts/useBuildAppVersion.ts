/**
 * Import before any `src/` module: sets `__APP_VERSION__` the way Vite's `define` does for `npm run build`
 * (`VITE_APP_VERSION`, else package.json's version), so a script lays the origin banner out with the
 * version the build prints instead of `appVersion.ts`'s `0.0.0-dev` fallback.
 */
import fs from 'node:fs';

export const PACKAGE_VERSION: string = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

export const BUILD_APP_VERSION: string = process.env.VITE_APP_VERSION?.trim() || PACKAGE_VERSION;

(globalThis as {__APP_VERSION__?: string}).__APP_VERSION__ = BUILD_APP_VERSION;
