#!/usr/bin/env node
/**
 * Byte-for-byte parity check for OpenCV's DICT_4X4_250 marker table.
 *
 * Installs the requested OpenCV wheel in a throwaway uv environment, runs
 * tests/opencv-qr-test/_aruco_dict_bytes.py, and compares the 500 rotation-0
 * bytes with src/skelly-charuco/dict4x4_250_rot0.ts (or --dict-file).
 *
 * Dependency-free Node 24 ESM. Exit codes: 0 identical, 1 mismatch,
 * 2 infrastructure or parse failure.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_BYTE_COUNT = 500;
const PACKAGE_NAME = 'opencv-contrib-python-headless';
const REQUIREMENTS_RELATIVE_PATH = path.join('tests', 'opencv-qr-test', 'requirements.txt');
const HELPER_RELATIVE_PATH = path.join('tests', 'opencv-qr-test', '_aruco_dict_bytes.py');
const DICT_RELATIVE_PATH = path.join('src', 'skelly-charuco', 'dict4x4_250_rot0.ts');
const DICT_LABEL = DICT_RELATIVE_PATH.split(path.sep).join('/');

const USAGE = `Usage: node tests/verify-opencv-aruco-bytes.mjs [options]

Compare OpenCV DICT_4X4_250 marker bytes from a uv-provided OpenCV wheel
against the committed TypeScript library.

Options:
  --opencv-version <ver>  OpenCV version to install (default: tests/opencv-qr-test/requirements.txt pin)
                          4-part wheel version (5.0.0.93) or 3-part cv2 version (5.0.0)
  --dict-file <path>      Compare against this TS module instead of the committed one
  --json                  Print one JSON object on stdout (diagnostics on stderr)
  -h, --help              Show this help

Exit codes: 0 = identical, 1 = bytes differ, 2 = infrastructure/parse failure.
`;

function parseArgs(argv) {
  const opts = { json: false, opencvVersion: null, dictFile: null, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--opencv-version' || arg.startsWith('--opencv-version=')) {
      const value = arg === '--opencv-version' ? argv[++i] : arg.slice('--opencv-version='.length);
      if (value === undefined || value === '') {
        throw new Error('--opencv-version requires a value');
      }
      opts.opencvVersion = value;
    } else if (arg === '--dict-file' || arg.startsWith('--dict-file=')) {
      const value = arg === '--dict-file' ? argv[++i] : arg.slice('--dict-file='.length);
      if (value === undefined || value === '') {
        throw new Error('--dict-file requires a value');
      }
      opts.dictFile = value;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return opts;
}

/** Quote one argument for a cmd.exe command line (no embedded quotes expected). */
function quoteForCmd(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

/** Find an executable on PATH without a shell, honoring PATHEXT on Windows. */
function resolveOnPath(command) {
  const pathValue = process.env.PATH ?? '';
  const isWindows = process.platform === 'win32';
  const extensions = isWindows
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [];
  // Prefer real executables (uv.exe) over extensionless files on Windows.
  const names = isWindows ? [...extensions.map((ext) => `${command}${ext}`), command] : [command];
  const dirs = pathValue
    .split(path.delimiter)
    .map((dir) => dir.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);

  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Not here; keep looking.
      }
    }
  }

  return null;
}

function readPinnedVersion(requirementsPath) {
  let text;
  try {
    text = fs.readFileSync(requirementsPath, 'utf8');
  } catch (err) {
    throw new Error(`cannot read ${requirementsPath}: ${err.message}`);
  }

  const match = text.match(
    /^\s*opencv-contrib-python-headless(?:\[[^\]]*\])?\s*==\s*([^\s#;]+)/m,
  );
  if (!match) {
    throw new Error(`no ${PACKAGE_NAME}==<version> pin found in ${requirementsPath}`);
  }
  return match[1];
}

/**
 * 4-part versions are wheel versions and are pinned exactly.
 * 3-part versions are cv2 versions and use a PEP 440 prefix match.
 */
function versionToRequirement(version) {
  const value = String(version).trim();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) {
    return { requested: value, specifier: `==${value}` };
  }
  if (/^\d+\.\d+\.\d+$/.test(value)) {
    return { requested: value, specifier: `==${value}.*` };
  }
  throw new Error(
    `unsupported OpenCV version "${value}": expected a 4-part wheel version ` +
      '(e.g. 5.0.0.93) or a 3-part cv2 version (e.g. 5.0.0)',
  );
}

function parseDictModule(source, dictPath) {
  const bytesMatch = source.match(
    /export\s+const\s+DICT_4X4_250_ROT0_BYTES\s*=\s*new\s+Uint8Array\(\s*\[([\s\S]*?)\]\s*\)\s*;/,
  );
  if (!bytesMatch) {
    throw new Error(`could not find DICT_4X4_250_ROT0_BYTES in ${dictPath}`);
  }

  const parts = bytesMatch[1]
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length !== EXPECTED_BYTE_COUNT) {
    throw new Error(
      `DICT_4X4_250_ROT0_BYTES in ${dictPath} has ${parts.length} entries, ` +
        `expected ${EXPECTED_BYTE_COUNT}`,
    );
  }
  const bytes = parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      throw new Error(`invalid byte value "${part}" in ${dictPath}`);
    }
    const value = Number(part);
    if (value > 255) {
      throw new Error(`byte value ${value} is out of range in ${dictPath}`);
    }
    return value;
  });

  const versionMatch = source.match(
    /export\s+const\s+DICT_4X4_250_SOURCE_OPENCV_VERSION\s*=\s*"([^"]*)"\s*;/,
  );

  return { bytes, opencvVersion: versionMatch ? versionMatch[1] : null };
}

/** The helper promises a single JSON object; tolerate stray log lines on stdout. */
function parseHelperOutput(stdout) {
  const text = stdout.trim();
  const candidates = [text, ...text.split(/\r?\n/).reverse()];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function validateHelperPayload(payload) {
  if (!payload) {
    throw new Error('uv/Python helper did not print a JSON object on stdout');
  }
  if (typeof payload.python !== 'string' || typeof payload.opencv !== 'string') {
    throw new Error('helper JSON is missing "python"/"opencv" strings');
  }
  if (!Array.isArray(payload.bytes)) {
    throw new Error('helper JSON is missing a "bytes" array');
  }
  if (payload.bytes.length !== EXPECTED_BYTE_COUNT) {
    throw new Error(
      `helper returned ${payload.bytes.length} bytes, expected ${EXPECTED_BYTE_COUNT}`,
    );
  }
  for (let i = 0; i < payload.bytes.length; i += 1) {
    const value = payload.bytes[i];
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error(`helper byte at index ${i} is not an integer 0-255: ${String(value)}`);
    }
  }
  return payload;
}

function sha256(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

function compareBytes(expected, actual) {
  let firstMismatch = -1;
  let mismatchCount = 0;

  for (let i = 0; i < expected.length; i += 1) {
    if (expected[i] !== actual[i]) {
      if (firstMismatch === -1) {
        firstMismatch = i;
      }
      mismatchCount += 1;
    }
  }

  return { firstMismatch, mismatchCount };
}

function reportFailure(jsonMode, message) {
  process.stderr.write(`ERROR: ${message}\n`);

  if (jsonMode) {
    const payload = {
      pass: false,
      opencvVersion: null,
      recordedOpenCVVersion: null,
      pythonVersion: null,
      byteCount: 0,
      sha256: null,
      error: message,
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  }

  return 2;
}

function run(opts) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dictPath = opts.dictFile
    ? path.resolve(process.cwd(), opts.dictFile)
    : path.join(root, DICT_RELATIVE_PATH);

  let dictSource;
  try {
    dictSource = fs.readFileSync(dictPath, 'utf8');
  } catch (err) {
    throw new Error(`cannot read dictionary file ${dictPath}: ${err.message}`);
  }
  const recorded = parseDictModule(dictSource, dictPath);

  const requestedVersion = opts.opencvVersion ?? readPinnedVersion(path.join(root, REQUIREMENTS_RELATIVE_PATH));
  const requirement = versionToRequirement(requestedVersion);

  const uvPath = resolveOnPath('uv');
  if (!uvPath) {
    throw new Error(
      'uv not found on PATH; install uv (https://docs.astral.sh/uv/) and re-run',
    );
  }

  const helperPath = path.join(root, HELPER_RELATIVE_PATH);
  const uvArgs = [
    'run',
    '--no-project',
    '--with',
    `${PACKAGE_NAME}${requirement.specifier}`,
    'python',
    helperPath,
  ];
  // Node cannot spawn .cmd/.bat shims directly without a shell (EINVAL on
  // Windows). Run those through cmd.exe with a verbatim, quoted command line;
  // this avoids shell:true, which merely concatenates arguments.
  const isWindowsShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(uvPath);
  const spawnCommand = isWindowsShim ? (process.env.ComSpec || 'cmd.exe') : uvPath;
  const spawnArgs = isWindowsShim
    ? ['/d', '/s', '/c', `"${[uvPath, ...uvArgs].map(quoteForCmd).join(' ')}"`]
    : uvArgs;
  const child = spawnSync(spawnCommand, spawnArgs, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    windowsVerbatimArguments: isWindowsShim,
  });

  if (child.stderr) {
    process.stderr.write(child.stderr.endsWith('\n') ? child.stderr : `${child.stderr}\n`);
  }
  if (child.error) {
    throw new Error(`failed to run uv (${uvPath}): ${child.error.message}`);
  }
  if (child.status !== 0) {
    const reason = child.signal ? `signal ${child.signal}` : `status ${child.status}`;
    throw new Error(`uv exited with ${reason}`);
  }
  if (typeof child.stdout !== 'string') {
    throw new Error('uv produced no stdout');
  }

  const payload = validateHelperPayload(parseHelperOutput(child.stdout));
  const { firstMismatch, mismatchCount } = compareBytes(recorded.bytes, payload.bytes);
  const expectedHash = sha256(recorded.bytes);
  const actualHash = sha256(payload.bytes);

  const result = {
    pass: mismatchCount === 0,
    opencvVersion: payload.opencv,
    recordedOpenCVVersion: recorded.opencvVersion,
    pythonVersion: payload.python,
    byteCount: payload.bytes.length,
    sha256: actualHash,
  };
  if (mismatchCount > 0) {
    result.firstMismatch = firstMismatch;
    result.mismatchCount = mismatchCount;
  }

  const dictLabel = opts.dictFile ? dictPath : DICT_LABEL;
  const provenance =
    `OpenCV: ${payload.opencv} ` +
    `(requested ${requirement.requested}; recorded ${recorded.opencvVersion ?? 'unknown'})`;
  const lines = [];

  if (result.pass) {
    lines.push(`PASS: OpenCV DICT_4X4_250 marker bytes match ${dictLabel}`);
    lines.push(provenance);
    lines.push(`Python: ${payload.python}`);
    lines.push(`Bytes: ${result.byteCount}`);
    lines.push(`SHA-256: ${result.sha256}`);
  } else {
    lines.push(`FAIL: OpenCV DICT_4X4_250 marker bytes differ from ${dictLabel}`);
    lines.push(provenance);
    lines.push(`Python: ${payload.python}`);
    lines.push(
      `First mismatch: index ${firstMismatch} ` +
        `(expected ${recorded.bytes[firstMismatch]} from dictionary file, ` +
        `actual ${payload.bytes[firstMismatch]} from OpenCV)`,
    );
    lines.push(`Differing bytes: ${mismatchCount} of ${result.byteCount}`);
    lines.push(`Expected SHA-256: ${expectedHash}`);
    lines.push(`Actual SHA-256: ${actualHash}`);
    lines.push(
      'Chart-spec-affecting: do not auto-regenerate this dictionary. ' +
        'Review the difference deliberately and bump the app major per README.',
    );
  }

  const report = `${lines.join('\n')}\n`;
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.stderr.write(report);
  } else {
    process.stdout.write(report);
  }

  return result.pass ? 0 : 1;
}

function main() {
  const argv = process.argv.slice(2);
  const jsonRequested = argv.includes('--json');

  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    return reportFailure(jsonRequested, err.message);
  }

  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  try {
    return run(opts);
  } catch (err) {
    return reportFailure(opts.json, err instanceof Error ? err.message : String(err));
  }
}

process.exitCode = main();
