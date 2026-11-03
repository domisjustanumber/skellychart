/**
 * Vite's build environment, read in one place. The tsx scripts (`npm run check:*`) load modules that
 * import this, and `import.meta.env` is undefined there, so keep the guard and touch no DOM here.
 * Vite writes `import.meta.env.DEV` as a literal, so release builds drop the code behind {@link IS_DEV}.
 */
const hasEnv = typeof import.meta.env !== 'undefined';

/** True only on the Vite dev server (`npm run dev`). */
export const IS_DEV = hasEnv && import.meta.env.DEV === true;

/** Base URL the app is served from (`public/` files sit there). */
export const BASE_URL = (hasEnv && import.meta.env.BASE_URL) || './';
