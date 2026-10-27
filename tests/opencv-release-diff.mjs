#!/usr/bin/env node
/**
 * opencv-release-diff.mjs
 *
 * Answers: "between two OpenCV source release tags, did any code that can
 * affect QR code / ArUco marker generation change?"
 *
 * Usage:
 *   node tests/opencv-release-diff.mjs --from <tag> --to <tag> [--json]
 *
 * Exit-code contract (do not "improve" this silently):
 *   0  PASS          no watched OpenCV QR/ArUco code changed
 *   1  FAIL          watched code changed; human review required
 *   2  INCONCLUSIVE  usage/network/API/ambiguity; never treat as PASS
 *
 * Strategy:
 *   1. Ask the GitHub compare API for the diff between the two tags and
 *      filter changed files against WATCHED_PATHS. A relevant file in that
 *      list is always proof of change.
 *   2. The compare API is a three-dot (PR-style) diff, so it only represents
 *      the full content difference when `to` descends from `from` (compare
 *      status "ahead"). It also caps its `files` array at 300 entries.
 *      Absence of a relevant file therefore proves a PASS only for "ahead"
 *      and an untruncated list.
 *   3. Otherwise fall back to per-path commits queries (for "ahead") and
 *      finally to comparing Git tree blob SHAs of the watched paths at each
 *      tag, which is correct for diverged or otherwise ambiguous histories.
 *   4. Anything unexpected exits 2 rather than passing by accident.
 */

import process from "node:process";

const API_BASE = "https://api.github.com";
const REPO = "opencv/opencv";
const COMPARE_FILES_CAP = 300;
const REQUEST_TIMEOUT_MS = 30_000;
const USER_AGENT = "skellychart-opencv-release-diff";

/**
 * Paths that govern ArUco dictionary data, board rendering, and QR encoding.
 * A trailing slash marks a watched directory (everything below it).
 */
const WATCHED_PATHS = [
  "modules/objdetect/src/aruco/",
  "modules/objdetect/src/qrcode.cpp",
  "modules/objdetect/src/qrcode_encoder.cpp",
  "modules/objdetect/src/qrcode_encoder_table.inl.hpp",
  "modules/objdetect/include/opencv2/objdetect/aruco_board.hpp",
  "modules/objdetect/include/opencv2/objdetect/aruco_detector.hpp",
  "modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp",
  "modules/objdetect/include/opencv2/objdetect/charuco_detector.hpp",
];

const USAGE =
  "Usage: node tests/opencv-release-diff.mjs --from <tag> --to <tag> [--json]";

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

class InconclusiveError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "InconclusiveError";
    this.details = details;
  }
}

function parseArgs(argv) {
  const options = { from: null, to: null, json: false, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--from" || arg === "--to") {
      const key = arg.slice(2);
      if (options[key] !== null) {
        throw new UsageError(`Duplicate ${arg}.`);
      }
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new UsageError(`Missing value for ${arg}.`);
      }
      options[key] = value;
      i += 1;
      continue;
    }

    throw new UsageError(`Unknown argument: ${arg}`);
  }

  if (options.help) {
    return options;
  }

  if (options.from === null || options.to === null) {
    throw new UsageError("Both --from and --to are required.");
  }

  return options;
}

/** Accepts `4.13.0` or `v4.13.0`; returns the canonical tag without the `v`. */
function normalizeTag(raw, label) {
  const normalized = raw.trim().replace(/^[vV]/, "");
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
    throw new UsageError(
      `Invalid ${label} tag "${raw}"; expected a 3-part release tag such as 4.13.0 or v4.13.0.`,
    );
  }
  return normalized;
}

function hasToken() {
  return Boolean(
    process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim(),
  );
}

async function githubRequest(apiPath) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": USER_AGENT,
  };
  const token =
    process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || "";
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${apiPath}`, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new InconclusiveError(
      `GitHub API request failed for ${apiPath}: ${error.message}`,
    );
  }

  const text = await response.text();

  if (!response.ok) {
    let apiMessage = "";
    try {
      const body = JSON.parse(text);
      if (typeof body?.message === "string") {
        apiMessage = `: ${body.message}`;
      }
    } catch {
      // Error bodies are not always JSON; the status code is enough.
    }

    let hint = "";
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = response.headers.get("x-ratelimit-reset");
    const resetSeconds = Number(reset);
    if (
      (response.status === 403 || response.status === 429) &&
      remaining === "0"
    ) {
      hint =
        reset !== null && Number.isFinite(resetSeconds)
          ? ` (rate limit exhausted; resets at ${new Date(resetSeconds * 1000).toISOString()})`
          : " (rate limit exhausted)";
    }
    if (response.status === 401) {
      hint += " (check GITHUB_TOKEN/GH_TOKEN)";
    }

    throw new InconclusiveError(
      `GitHub API ${response.status} for ${apiPath}${apiMessage}${hint}`,
      { status: response.status },
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new InconclusiveError(
      `GitHub API returned a non-JSON response for ${apiPath}.`,
    );
  }
}

function matchWatchedPath(filename) {
  return WATCHED_PATHS.find((watched) =>
    watched.endsWith("/") ? filename.startsWith(watched) : filename === watched,
  );
}

/** File names in the compare payload that touch a watched path. */
function collectRelevantFiles(files) {
  const relevant = new Set();

  for (const file of files) {
    if (typeof file?.filename !== "string") {
      // Do not silently skip an entry: it could have been a watched file.
      throw new InconclusiveError(
        "Compare API returned a changed-file entry without a filename.",
      );
    }
    if (matchWatchedPath(file.filename)) {
      relevant.add(file.filename);
    }
    // A rename out of a watched directory is relevant too.
    if (
      typeof file.previous_filename === "string" &&
      matchWatchedPath(file.previous_filename)
    ) {
      relevant.add(file.previous_filename);
    }
  }

  return [...relevant].sort();
}

async function runCompare(from, to) {
  const data = await githubRequest(
    `/repos/${REPO}/compare/${encodeURIComponent(from)}...${encodeURIComponent(to)}`,
  );

  if (typeof data !== "object" || data === null) {
    throw new InconclusiveError("Compare API returned an unexpected payload.");
  }

  if (data.status === "identical") {
    return {
      decisive: true,
      pass: true,
      relevantFiles: [],
      method: "compare",
      details: {
        compareStatus: "identical",
        totalCommits: 0,
        filesReported: 0,
        truncated: false,
      },
    };
  }

  if (!Array.isArray(data.files)) {
    // Without a files array the compare result cannot prove a PASS.
    return {
      decisive: false,
      reason: "compare response did not include a files array",
      compareStatus: data.status ?? null,
      filesReported: null,
    };
  }

  const compareStatus = data.status ?? null;
  const relevantFiles = collectRelevantFiles(data.files);
  const filesReported = data.files.length;
  const possiblyTruncated = filesReported >= COMPARE_FILES_CAP;
  const details = {
    compareStatus,
    totalCommits:
      typeof data.total_commits === "number" ? data.total_commits : null,
    filesReported,
    truncated: possiblyTruncated,
  };

  if (relevantFiles.length > 0) {
    // One listed relevant file is proof of change, even from a truncated list.
    return {
      decisive: true,
      pass: false,
      relevantFiles,
      method: "compare",
      details,
    };
  }

  if (!possiblyTruncated && compareStatus === "ahead") {
    // Only a three-dot diff where `to` descends from `from` covers every
    // content change between the tags. For "diverged"/"behind"/unknown
    // histories, files changed only on the base side are absent from this
    // list, so absence cannot prove a PASS.
    return {
      decisive: true,
      pass: true,
      relevantFiles: [],
      method: "compare",
      details,
    };
  }

  const reason = possiblyTruncated
    ? `compare API reported ${filesReported} changed files (cap is ${COMPARE_FILES_CAP}); the list may be truncated`
    : `compare status is "${compareStatus ?? "unknown"}", not "ahead"; the three-dot file list cannot prove the tags' content is equal`;
  return {
    decisive: false,
    reason,
    compareStatus,
    filesReported,
  };
}

/**
 * Reliable fallback when the compare file list is unusable: one commits query
 * per watched path, restricted to commits reachable from the `to` tag and
 * committed after the `from` tag. A non-empty result means relevant change.
 *
 * Requires compare status "ahead": the since-based query only proves absence
 * of changes when the `to` tag descends from the `from` tag.
 */
async function runPerPathFallback(from, to, compareContext) {
  if (compareContext.compareStatus !== "ahead") {
    throw new InconclusiveError(
      `Cannot use per-path fallback: compare status is "${compareContext.compareStatus ?? "unknown"}", not "ahead". ` +
        `The since-based query would not be reliable.`,
      { compareStatus: compareContext.compareStatus ?? null },
    );
  }

  const [fromCommit, toCommit] = await Promise.all([
    githubRequest(`/repos/${REPO}/commits/${encodeURIComponent(from)}`),
    githubRequest(`/repos/${REPO}/commits/${encodeURIComponent(to)}`),
  ]);

  const since = fromCommit?.commit?.committer?.date;
  const toSha = toCommit?.sha;
  if (typeof since !== "string" || Number.isNaN(Date.parse(since))) {
    throw new InconclusiveError(
      `Could not read the committer date of tag ${from}; cannot run per-path fallback.`,
    );
  }
  if (typeof toSha !== "string" || toSha.length === 0) {
    throw new InconclusiveError(
      `Could not resolve tag ${to} to a commit; cannot run per-path fallback.`,
    );
  }

  const checks = await Promise.all(
    WATCHED_PATHS.map(async (watchedPath) => {
      // The commits API filters directory paths by their children; a trailing
      // slash is not needed and makes the query look like an exact file.
      const queryPath = watchedPath.replace(/\/+$/, "");
      const params = new URLSearchParams({
        path: queryPath,
        sha: toSha,
        since,
        per_page: "1",
      });
      const commits = await githubRequest(
        `/repos/${REPO}/commits?${params.toString()}`,
      );
      if (!Array.isArray(commits)) {
        throw new InconclusiveError(
          `Commits API returned an unexpected payload for ${watchedPath}.`,
        );
      }
      return {
        path: watchedPath,
        changed: commits.length > 0,
        latestCommit: commits[0]?.sha ?? null,
      };
    }),
  );

  const changedPaths = checks
    .filter((check) => check.changed)
    .map((check) => check.path);

  return {
    pass: changedPaths.length === 0,
    relevantFiles: changedPaths,
    method: "per-path-commits",
    details: {
      reason: compareContext.reason,
      compareStatus: compareContext.compareStatus ?? null,
      compareFilesReported: compareContext.filesReported ?? null,
      since,
      fromCommit: fromCommit?.sha ?? null,
      toCommit: toSha,
      checkedPaths: checks,
    },
  };
}

/**
 * Last-resort fallback that works regardless of branch ancestry: list the
 * recursive Git tree for each tag and compare blob SHAs for watched paths.
 * Uses two API requests and no source/download archives. If either tree is
 * truncated the answer is inconclusive (exit 2), never PASS.
 */
async function runTreeSnapshotFallback(from, to, compareContext) {
  const [fromTree, toTree] = await Promise.all(
    [from, to].map((tag) =>
      githubRequest(`/repos/${REPO}/git/trees/${encodeURIComponent(tag)}?recursive=1`),
    ),
  );

  if (fromTree?.truncated === true || toTree?.truncated === true) {
    throw new InconclusiveError(
      "Git Trees API response was truncated; cannot compare watched paths reliably.",
    );
  }
  if (!Array.isArray(fromTree?.tree) || !Array.isArray(toTree?.tree)) {
    throw new InconclusiveError(
      "Git Trees API returned an unexpected payload.",
    );
  }

  const fromBlobs = watchedBlobMap(fromTree.tree);
  const toBlobs = watchedBlobMap(toTree.tree);
  const changedFiles = [];

  for (const path of [...new Set([...fromBlobs.keys(), ...toBlobs.keys()])].sort()) {
    if (fromBlobs.get(path) !== toBlobs.get(path)) {
      changedFiles.push(path);
    }
  }

  return {
    pass: changedFiles.length === 0,
    relevantFiles: changedFiles,
    method: "tree-snapshot",
    details: {
      reason: compareContext.reason,
      compareStatus: compareContext.compareStatus ?? null,
      compareFilesReported: compareContext.filesReported ?? null,
      fromTree: fromTree.sha ?? null,
      toTree: toTree.sha ?? null,
      inspectedFiles: fromBlobs.size + toBlobs.size,
      truncated: false,
    },
  };
}

/** Map watched-path file -> blob SHA from a recursive Git tree listing. */
function watchedBlobMap(treeEntries) {
  const blobs = new Map();
  for (const entry of treeEntries) {
    if (typeof entry?.path !== "string" || typeof entry?.type !== "string") {
      throw new InconclusiveError(
        "Git Trees API returned an entry without a path or type.",
      );
    }
    if (entry.type !== "blob") {
      continue;
    }
    if (typeof entry.sha !== "string") {
      throw new InconclusiveError(
        `Git Trees API returned a blob without a SHA (${entry.path}).`,
      );
    }
    if (matchWatchedPath(entry.path)) {
      blobs.set(entry.path, entry.sha);
    }
  }
  return blobs;
}

function describeMethod(result) {
  switch (result.method) {
    case "compare":
      return "GitHub compare API";
    case "per-path-commits":
      return "per-path commits API (compare file list was unavailable or possibly truncated)";
    case "tree-snapshot":
      return "Git tree blob comparison of watched paths at each tag";
    case "no-op":
      return "identical normalized tags (no network call)";
    default:
      return result.method;
  }
}

function printHumanResult(result) {
  const lines = [];
  lines.push(`OpenCV release diff: ${result.from} -> ${result.to}`);
  lines.push(`Method: ${describeMethod(result)}`);

  if (
    (result.method === "per-path-commits" ||
      result.method === "tree-snapshot") &&
    result.details?.reason
  ) {
    lines.push(`Note: ${result.details.reason}.`);
  }

  if (result.relevantFiles.length > 0) {
    lines.push(
      result.method === "per-path-commits"
        ? "Relevant watched paths with commits:"
        : "Relevant changed files:",
    );
    for (const file of result.relevantFiles) {
      lines.push(`  - ${file}`);
    }
  } else {
    lines.push("Relevant changed files: none");
  }

  if (result.pass) {
    lines.push(
      `PASS: no watched OpenCV QR/ArUco code changed between ${result.from} and ${result.to}.`,
    );
  } else {
    lines.push(
      `FAIL: watched OpenCV QR/ArUco code changed between ${result.from} and ${result.to}.`,
    );
    lines.push(
      "Note: the OpenCV pin change needs human review and verification before merge.",
    );
  }

  console.log(lines.join("\n"));
}

function outputResult(result, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    printHumanResult(result);
  }
  process.exitCode = result.pass ? 0 : 1;
}

function reportError(error, asJson, from, to) {
  const message = error instanceof Error ? error.message : String(error);
  const extraDetails =
    error instanceof InconclusiveError ? error.details : undefined;

  if (!asJson && (from !== null || to !== null)) {
    console.error(`OpenCV release diff: ${from ?? "?"} -> ${to ?? "?"}`);
  }
  // Diagnostics always go to stderr, including with --json, keeping stdout to
  // exactly one JSON object.
  console.error(`ERROR: ${message}`);
  if (error instanceof UsageError) {
    console.error(USAGE);
  }

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({
        from: from ?? null,
        to: to ?? null,
        pass: null,
        relevantFiles: [],
        method: "error",
        details: { error: message, ...extraDetails },
      })}\n`,
    );
  }

  console.error(
    "INCONCLUSIVE: unable to determine whether watched OpenCV code changed; exiting 2.",
  );
  process.exitCode = 2;
}

async function main(argv) {
  // Detect --json before parsing so malformed invocations still emit one JSON
  // object on stdout (with pass: null) when the caller asked for JSON.
  const jsonRequested = argv.includes("--json");

  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    reportError(error, jsonRequested, null, null);
    return;
  }

  if (options.help) {
    console.log(USAGE);
    return;
  }

  let from;
  let to;
  try {
    from = normalizeTag(options.from, "--from");
    to = normalizeTag(options.to, "--to");
  } catch (error) {
    reportError(error, options.json, null, null);
    return;
  }

  if (from === to) {
    outputResult(
      {
        from,
        to,
        pass: true,
        relevantFiles: [],
        method: "no-op",
        details: {
          reason:
            "from and to are the same tag after normalization; no network call made",
        },
      },
      options.json,
    );
    return;
  }

  if (!hasToken()) {
    console.error(
      "Warning: GITHUB_TOKEN/GH_TOKEN is not set; using unauthenticated GitHub API " +
        "(60 requests/hour). Set GITHUB_TOKEN to raise the limit.",
    );
  }

  try {
    const compare = await runCompare(from, to);

    let result;
    if (compare.decisive) {
      result = {
        from,
        to,
        pass: compare.pass,
        relevantFiles: compare.relevantFiles,
        method: compare.method,
        details: compare.details,
      };
    } else {
      console.error(`Note: ${compare.reason}; a fallback method is required.`);

      let fallback = null;
      let perPathError = null;

      if (compare.compareStatus === "ahead") {
        console.error("Note: using per-path commit queries.");
        try {
          fallback = await runPerPathFallback(from, to, compare);
        } catch (error) {
          perPathError = error;
          console.error(
            `Note: per-path fallback was inconclusive: ${error.message}`,
          );
        }
      } else {
        console.error(
          `Note: compare status is "${compare.compareStatus ?? "unknown"}", so a since-based per-path query cannot prove absence; using tree snapshot comparison.`,
        );
      }

      if (fallback === null) {
        console.error("Note: using Git tree blob comparison of watched paths.");
        try {
          fallback = await runTreeSnapshotFallback(from, to, compare);
        } catch (treeError) {
          if (perPathError !== null) {
            throw new InconclusiveError(
              `Both fallbacks were inconclusive. Per-path: ${perPathError.message} Tree snapshot: ${treeError.message}`,
            );
          }
          throw treeError;
        }
      }

      result = { from, to, ...fallback };
    }

    outputResult(result, options.json);
  } catch (error) {
    reportError(error, options.json, from, to);
  }
}

await main(process.argv.slice(2));
