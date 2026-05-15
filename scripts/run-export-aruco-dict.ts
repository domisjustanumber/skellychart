/**
 * Runs scripts/export_dict4x4_250_ts.py (OpenCV → src/skelly-charuco/dict4x4_250_rot0.ts).
 * Tries, in order: project .venv Python, `python`, Windows `py -3`, then `uv run --with opencv-contrib-python-headless`.
 */
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pyScript = join(root, 'scripts', 'export_dict4x4_250_ts.py');
const venvWin = join(root, '.venv', 'Scripts', 'python.exe');
const venvUnix = join(root, '.venv', 'bin', 'python');

type Attempt = readonly [command: string, args: readonly string[]];

const attempts: Attempt[] = [];
if (existsSync(venvWin)) {
    attempts.push([venvWin, [pyScript]]);
} else if (existsSync(venvUnix)) {
    attempts.push([venvUnix, [pyScript]]);
}
attempts.push(['python', [pyScript]]);
attempts.push(['py', ['-3', pyScript]]);
attempts.push([
    'uv',
    ['run', '--with', 'opencv-contrib-python-headless', 'python', pyScript],
]);

for (const [cmd, args] of attempts) {
    const r = spawnSync(cmd, [...args], {
        cwd: root,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });
    if (r.status === 0) {
        process.exit(0);
    }
}

console.error(
    'Could not run export_dict4x4_250_ts.py (install OpenCV in .venv, or put python on PATH, or use uv).',
);
process.exit(1);
