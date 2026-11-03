/**
 * Guardrail run by `prebuild`: the app version must be one a build may stamp (`APP_VERSION_RE`, the
 * grammar the chart link reader accepts), and `package-lock.json` must agree with `package.json`.
 *
 * Printed charts embed the app version in their QR URL, so a drifted or malformed
 * version would make charts harder to trace back to the generator that made them.
 */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {APP_VERSION_RE} from '../src/print/chartVersion.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function fail(message: string): never {
    console.error(`check:version: ${message}`);
    process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
    version?: string;
};
const version = pkg.version;
if (typeof version !== 'string') {
    fail('package.json has no "version" field');
}

if (!APP_VERSION_RE.test(version)) {
    fail(`package.json "version" must be x.y.z or x.y.z-prerelease, got ${JSON.stringify(version)}`);
}

const lock = JSON.parse(readFileSync(join(repoRoot, 'package-lock.json'), 'utf8')) as {
    version?: string;
    packages?: Record<string, {version?: string}>;
};
const lockVersions = [lock.version, lock.packages?.['']?.version];
if (lockVersions.some((v) => v !== version)) {
    fail(
        `package-lock.json versions (${lockVersions.map((v) => JSON.stringify(v)).join(', ')}) ` +
            `do not match package.json ${version}. Run: npm install --package-lock-only --ignore-scripts --no-audit --no-fund`,
    );
}

console.log(`check:version: ${version} OK`);
