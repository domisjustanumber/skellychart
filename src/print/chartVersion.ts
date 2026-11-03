export interface ChartVersion {
    major: number;
    minor: number;
    patch: number;
    /** Present for dev/pre-release builds; ignored when comparing chart compatibility. */
    prerelease: string | null;
}

/**
 * The version a build stamps: `x.y.z` with an optional prerelease, and no `v` prefix or `+build`
 * metadata. The packed link reader is built from it, so whatever a build may stamp also parses.
 * No imports: `vite.config.ts` and the tsx scripts load this module too.
 */
export const APP_VERSION_SOURCE = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`;
export const APP_VERSION_RE = new RegExp(`^(?:${APP_VERSION_SOURCE})$`);

/** Tolerant reader for every token ever printed, including legacy bare integers and `v` prefixes. */
const CHART_VERSION_RE =
    /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Parse the version token from a chart link.
 *
 * - A bare integer reads as `1` → 1.0.0 (legacy charts' `v=1`, which the link reader now ignores).
 * - Current charts use the app semver: `1.4.2`.
 * - Malformed tokens, including the dev-server literal `develop` (no numeric core), return null
 *   so the link is still usable for board geometry.
 */
export function parseChartVersion(raw: string): ChartVersion | null {
    const m = CHART_VERSION_RE.exec(raw.trim());
    if (!m) {
        return null;
    }
    const major = Number(m[1]);
    const minor = m[2] === undefined ? 0 : Number(m[2]);
    const patch = m[3] === undefined ? 0 : Number(m[3]);
    if (![major, minor, patch].every(Number.isSafeInteger)) {
        return null;
    }
    return {major, minor, patch, prerelease: m[4] ?? null};
}

/**
 * Positive when `a` is newer than `b`; compares the numeric core only.
 *
 * Prerelease/build suffixes are ignored: a dev build must not look newer than the
 * release it precedes, and exact build ordering is not what the printed-chart
 * warning is about. The dev token (`develop`) does not parse at all, so dev builds
 * never raise the “newer version” warning.
 */
export function compareChartVersions(a: ChartVersion, b: ChartVersion): number {
    return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}
