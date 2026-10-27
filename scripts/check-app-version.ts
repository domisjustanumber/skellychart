/**
 * Guardrail run by `prebuild`: the app version must be semver, its major must match the
 * printed-label spec version, and `package-lock.json` must agree with `package.json`.
 *
 * Printed charts embed the app version in their QR URL, so a drifted or malformed
 * version would make charts harder to trace back to the generator that made them.
 */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {CHARUCO_PRINT_LABEL_SPEC_VERSION} from '../src/print/constants.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Keep in sync with `SEMVER` in `vite.config.ts`. */
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

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

const match = SEMVER.exec(version);
if (!match) {
    fail(`package.json "version" must be semver, got ${JSON.stringify(version)}`);
}

const major = Number(match[1]);
if (major !== CHARUCO_PRINT_LABEL_SPEC_VERSION) {
    fail(
        `app major ${major} (package.json ${version}) must equal CHARUCO_PRINT_LABEL_SPEC_VERSION ` +
            `(${CHARUCO_PRINT_LABEL_SPEC_VERSION}) in src/print/constants.ts — bump both together.`,
    );
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

console.log(`check:version: ${version} (label spec v${CHARUCO_PRINT_LABEL_SPEC_VERSION}) OK`);
