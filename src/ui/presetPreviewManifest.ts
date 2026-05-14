/**
 * Static preset previews live under `public/generated-presets/` (see `scripts/bake-preset-previews.ts`).
 */
export type PresetPreviewManifestEntry = {
    board: string;
    thumbs: string[];
    /** Pre-rendered print PDF (same bytes as renderCharucoPrintPdf for this preset). */
    pdf: string;
    totalPages: number;
    truncated: boolean;
};

export type PresetPreviewManifest = Record<string, PresetPreviewManifestEntry>;

let cached: PresetPreviewManifest | null | undefined;

export function presetPreviewBasePath(): string {
    return `${import.meta.env.BASE_URL}generated-presets/`;
}

export function resolvePresetAssetUrl(relativePath: string): string {
    return new URL(relativePath, new URL(presetPreviewBasePath(), window.location.href)).href;
}

export async function loadPresetPreviewManifest(): Promise<PresetPreviewManifest | null> {
    if (cached !== undefined) {
        return cached;
    }
    try {
        const url = `${presetPreviewBasePath()}manifest.json`;
        const res = await fetch(url, {cache: 'no-store'});
        if (!res.ok) {
            cached = null;
            return null;
        }
        cached = (await res.json()) as PresetPreviewManifest;
        return cached;
    } catch {
        cached = null;
        return null;
    }
}

export function presetPreviewKey(distanceId: string, paperId: string): string {
    return `${distanceId}:${paperId}`;
}
