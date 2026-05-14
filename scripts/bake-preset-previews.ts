/**
 * Pre-generates ChaRuCo preview assets for every (working distance × paper size) preset.
 * Run before `vite` / `vite build` via npm scripts.
 *
 * Uses a process pool (`node --import tsx` per preset) so CPU-heavy work runs on multiple
 * cores. Node's main thread alone cannot parallelize Promise.all for compute-bound tasks, and
 * worker_threads + tsx do not share the same TypeScript resolution as the main loader.
 */
import {spawn} from 'node:child_process';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {availableParallelism, cpus} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import type {PresetPreviewManifest, PresetPreviewManifestEntry} from '../src/ui/presetPreviewManifest.js';
import {bakeOnePreset, listPresetJobs, mapPool, patchDomGlobals} from './bake-preset-shared.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'public', 'generated-presets');

function cpuParallelism(): number {
    try {
        return availableParallelism();
    } catch {
        return Math.max(1, cpus().length);
    }
}

function runPresetChildProcess(
    job: ReturnType<typeof listPresetJobs>[number],
    paths: {outDir: string; root: string},
): Promise<{key: string; entry: PresetPreviewManifestEntry}> {
    return new Promise((resolve, reject) => {
        const childPath = fileURLToPath(new URL('./bake-preset-child.ts', import.meta.url));
        const payload = JSON.stringify({
            outDir: paths.outDir,
            root: paths.root,
            distanceId: job.distanceId,
            paper: job.paper,
        });
        const child = spawn(process.execPath, ['--import', 'tsx', childPath, payload], {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            env: {...process.env},
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', (chunk: string) => {
            stdout += chunk;
        });
        child.stderr?.on('data', (chunk: string) => {
            stderr += chunk;
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(stderr.trim() || `bake child exited with code ${code}`));
                return;
            }
            const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
            if (!line) {
                reject(new Error(`bake child produced no stdout; stderr: ${stderr.slice(0, 500)}`));
                return;
            }
            try {
                resolve(JSON.parse(line) as {key: string; entry: PresetPreviewManifestEntry});
            } catch {
                reject(new Error(`bake child bad JSON: ${line.slice(0, 240)}…`));
            }
        });
    });
}

async function main(): Promise<void> {
    process.env.CHARUCO_LOGO_FILE = join(root, 'public', 'freemocap-logo.svg');

    const jobs = listPresetJobs();
    const useChildProcs = process.env.BAKE_PRESETS_IN_MAIN_THREAD !== '1';
    const poolSize = Math.max(1, cpuParallelism());

    rmSync(outDir, {recursive: true, force: true});
    mkdirSync(outDir, {recursive: true});

    let results: {key: string; entry: PresetPreviewManifestEntry}[];

    if (useChildProcs) {
        results = await mapPool(jobs, poolSize, (job) => runPresetChildProcess(job, {outDir, root}));
    } else {
        patchDomGlobals();
        const {renderCharucoPrintPdf} = await import('../src/print/pdfDocument.js');
        results = await mapPool(jobs, poolSize, async (job) =>
            bakeOnePreset(job.distanceId, job.paper, outDir, renderCharucoPrintPdf),
        );
    }

    const manifest: PresetPreviewManifest = {};
    for (const {key, entry} of results) {
        manifest[key] = entry;
    }

    writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const num = Object.keys(manifest).length;
    const mode = useChildProcs ? `process pool (~${poolSize} concurrent)` : 'main thread';
    console.log(`bake-preset-previews: wrote ${num} presets (${mode}) to public/generated-presets/`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
