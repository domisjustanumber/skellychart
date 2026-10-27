# Dependency updates

This repository keeps three dependency surfaces intentionally pinned:

| Surface | File(s) | Pinned by |
| --- | --- | --- |
| npm runtime + dev dependencies | `package.json`, `package-lock.json` | exact versions, no `^`/`~` |
| GitHub Actions | `.github/workflows/*.yml` | `uses: owner/action@vN` tags |
| Python tooling (OpenCV, ArUco export/verification only) | `tests/opencv-qr-test/requirements.txt` | exact `==` wheel versions |

The site build does not need Python or OpenCV; OpenCV is used only by the ArUco
dictionary export and the verification scripts described in
[aruco-dictionary.md](aruco-dictionary.md).

## How the pins work

### npm

- `.npmrc` sets `save-exact=true`, so `npm install <pkg>` writes a pinned
  version rather than a semver range.
- `package.json` has exact versions (`qrcode` 1.5.4; dev:
  `@types/qrcode` 1.5.6, `tsx` 4.23.15, `typescript` 7.0.2, `vite` 8.3.5).
- `package-lock.json` is committed and CI installs with `npm ci`.
- To bump by hand, always pass an exact version or `@latest` with `--save-exact`:

  ```bash
  npm install --save-exact qrcode@latest
  npm install --save-exact --save-dev vite@latest
  npm ci
  npm run build
  ```

  Plain `npm update` does **not** cross an exact pin: there is no range to move
  within. That matters for the Option D fallback below.

### Python / OpenCV

- `tests/opencv-qr-test/requirements.txt` pins `opencv-contrib-python-headless==5.0.0.93` and its
  `numpy` runtime (`numpy==2.5.4`) so the verification environment resolves the
  same way every run.
- OpenCV Python wheel versions have four parts (`5.0.0.93`); OpenCV source
  release tags have three (`5.0.0`). The CI gate maps the wheel to the source
  tag by dropping the fourth component.
- A wheel **patch** bump (`5.0.0.93` -> `5.0.0.94`) keeps the same source tag.
  The upstream release diff then trivially passes, but the committed marker
  bytes and the ChArUco raster are still re-verified against the new wheel.
- A new source release (`5.0.0.93` -> `5.0.1.84`, tag `5.0.0` -> `5.0.1`) also
  runs the upstream source audit. See [OpenCV gate](#opencv-gate) below.

## Dependabot configuration

[`.github/dependabot.yml`](../.github/dependabot.yml) configures three
ecosystems: npm and GitHub Actions at the repository root, and pip under
`tests/opencv-qr-test`. All run weekly (Mondays):

| Ecosystem | Manifest | Grouping | Notes |
| --- | --- | --- | --- |
| `npm` | `package.json` / `package-lock.json` | minor + patch in one PR; majors individually | `versioning-strategy: increase` keeps exact pins exact by raising them |
| `github-actions` | `.github/workflows/*.yml` | minor + patch in one PR; majors individually | commit prefix `chore(ci)` |
| `pip` | `tests/opencv-qr-test/requirements.txt` | minor + patch in one PR; majors individually | OpenCV wheel updates |

Each ecosystem has `open-pull-requests-limit: 5`, labels (`dependencies` plus
`npm` / `github-actions` / `python`) and a `chore(deps)`-style commit prefix.
Grouped updates reduce PR noise while keeping breaking (major) updates
separate for review. Dependabot PRs run the same `CI` workflow as any other PR.

### Dependabot and secrets

Dependabot-triggered `pull_request` runs get a read-only `GITHUB_TOKEN` by
default, and regular repository Actions secrets are not available (only
[Dependabot secrets](https://docs.github.com/en/code-security/dependabot/dependabot-secrets)
and the automatic token).

A workflow's `permissions:` block can raise the token's scopes, subject to
repository/organization policy. This repo still splits the write-token work
into a `workflow_run` workflow: that runs the trusted default-branch copy of
the workflow and never executes PR-modified workflow code with a write token.
The GitHub-documented `pull_request` + `permissions` pattern is a valid
alternative when that isolation is not needed.

`CI` needs nothing more than the read-only token: `npm ci` and
`npm run build` need no secrets, the release diff only reads public GitHub API
data (the read-only token raises the rate limit), and the byte/raster checks
download OpenCV from PyPI. See [Auto-merge](#auto-merge-options).

## CI workflow

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on:

- `pull_request` (every branch), and
- `workflow_dispatch` (manual).

It does **not** run on push to `main`: `deploy-pages.yml` already builds every
push to main, and its release bump is pushed with `GITHUB_TOKEN` and `[skip ci]`
so it cannot start a second deploy.

Steps:

1. `actions/checkout@v6` with `fetch-depth: 0` - full history and all remote
   branches are needed to diff against `origin/<base>` and to `git show` the
   base `tests/opencv-qr-test/requirements.txt`.
2. `actions/setup-node@v6` with Node 24 and the npm cache.
3. `npm ci`.
4. `npm run build` - codegen, `tsc -b`, Vite build, version guardrails.
5. OpenCV gate, only when `tests/opencv-qr-test/requirements.txt` changed
   (see below).

The job is named **`CI`** on purpose. Rulesets/branch protection require that
check name, and `dependabot-auto-merge.yml` listens for this workflow by its
name. Renaming the workflow or the job means updating both places.

## OpenCV gate

The gate is diff-driven. On a pull request:

1. CI runs
   `git diff --name-only "origin/$BASE...HEAD" -- tests/opencv-qr-test/requirements.txt`.
   If that is empty, the gate steps are skipped and only the normal build ran.
2. If the file changed, CI reads the old pin with
   `git show "origin/$BASE:tests/opencv-qr-test/requirements.txt"`, reads the
   new pin from the working tree, validates both are dotted numeric versions,
   and maps each wheel to its 3-part source tag (drop the fourth component;
   other shapes pass through and are rejected by the script). If the PR adds
   `tests/opencv-qr-test/requirements.txt` for the first time there is no old
   pin: CI treats the new pin as the baseline, so the release diff is a no-op,
   and still runs the byte and raster checks against it.
3. It then runs, in order:

   | # | Command | Exit 0 | Exit 1 | Exit 2 |
   | --- | --- | --- | --- | --- |
   | 1 | `node tests/opencv-release-diff.mjs --from <old-tag> --to <new-tag>` | no watched OpenCV QR/ArUco source changed | watched source changed - human review required | indeterminate (network/API/usage/truncation) |
   | 2 | `node tests/verify-opencv-aruco-bytes.mjs --opencv-version <new-wheel>` | committed `DICT_4X4_250` bytes match the wheel | bytes differ - chart-spec change | infrastructure error |
   | 3 | `npm run verify:opencv-raster` | TypeScript raster matches `CharucoBoard.generateImage` byte-for-byte | raster differs | infrastructure error |

   All three checks run even when step 1 exits non-zero: a source change
   requires human review, but the byte and raster results tell the reviewer
   whether the committed output still matches. Any non-zero exit from any step
   fails the `CI` job, so a failed step 1 still blocks auto-merge. Exit 2 is
   never treated as a pass. Step 1 is a no-op pass when only the wheel patch
   changed (same 3-part tag); steps 2 and 3 still run.

4. If `tests/opencv-qr-test/requirements.txt` changed but the OpenCV pin itself
   did not (for example
   another Python package was added), the old and new tags are equal, step 1
   passes trivially, and steps 2-3 still verify the working tree's
   requirements against the committed data.

On `workflow_dispatch` there is no PR base ref, so the gate is skipped and only
the build runs. To exercise the gate manually, use the local commands below.

The gate needs network access (GitHub API and PyPI) and `uv`. The workflow
installs `uv` with the official installer if the runner image does not already
provide it.

### What a gate failure means

A red gate is intentional. Dependabot auto-merge never runs for a failed CI
run, so a failing OpenCV PR always gets human review.

- **Release diff exit 1** - OpenCV changed code that can affect ArUco
  dictionaries, board rendering or QR encoding (watched paths in
  `tests/opencv-release-diff.mjs`). Decide whether the change affects the
  chart:
  - If marker bit patterns changed, that is a **chart-spec change**. Regenerate
    `src/skelly-charuco/dict4x4_250_rot0.ts` (see
    [aruco-dictionary.md](aruco-dictionary.md)), re-run the byte and raster
    checks, and ship it with a **major** version bump plus a matching
    `CHARUCO_PRINT_LABEL_SPEC_VERSION` (see the versioning rules in the
    [README](../README.md)). An older printed sheet decoded with new OpenCV is
    exactly the incompatibility the major version signals.
  - If rendering/marker geometry changed but the bytes did not, the raster
    check will show whether printed output changed; treat any change to what is
    printed as a chart-spec change.
  - If review concludes the upstream change cannot affect this project's
    output, merge deliberately (a configured ruleset bypass actor, such as a
    repository admin, can override the required check) and explain why in the
    PR. Do not weaken the gate to make a PR green without that review.
- **Release diff exit 2** - indeterminate. Re-run the job (transient network,
  API rate limit) or run the command locally with `GITHUB_TOKEN` set. Never
  merge on an indeterminate result without doing the review manually.
- **Byte verification exit 1** - the committed ArUco bytes differ from the new
  OpenCV. This is a chart-spec change: regenerate the dictionary module, verify
  the raster, and bump the major version. Do not hand-edit the bytes.
- **Byte verification/raster exit 2, uv install failure** - infrastructure.
  Re-run; check network access and that the pinned wheel exists on PyPI.
- **Raster mismatch** - the TypeScript renderer no longer matches OpenCV for
  the default board. Investigate whether marker bytes or rendering geometry
  changed; either way, printed output changed, so the chart-spec/major-version
  rules apply.

A wheel-patch-only bump that passes steps 1-3 is safe to merge automatically:
the committed data still matches the new wheel and the rendered output is
unchanged.

## Auto-merge options

Auto-merge and repository rulesets are free for public repositories. The
repo-specific constraint is `deploy-pages.yml`: it pushes its patch bump to
`main` with `GITHUB_TOKEN` on every merge, and GitHub Actions is **not** an
eligible ruleset bypass actor. A protected `main` therefore blocks that push
unless the bump is pushed with a bypass-capable identity. Choose accordingly.

| Option | Mechanism | Required settings | Trade-offs |
| --- | --- | --- | --- |
| **A. Direct merge (recommended)** | Dependabot PR -> `CI` green -> `workflow_run` runs `gh pr merge --squash --match-head-commit <tested SHA>` | Repository variable `DEPENDABOT_DIRECT_MERGE=true`; allow squash merging | Automatic and atomic: only the exact commit CI validated can merge. No "Allow auto-merge", no ruleset, no extra secret, and the deploy bump push keeps working. No git-level protection on `main`. `github-actions` PRs are skipped for manual merge unless `DEPENDABOT_MERGE_TOKEN` is set. |
| **B. Native auto-merge, no ruleset** | `workflow_run` enables auto-merge after CI green, pinned to the tested SHA | Settings -> General -> Allow auto-merge; allow squash merging | Uses GitHub's auto-merge feature without a ruleset. Without required checks GitHub merges as soon as it is enabled, so the gate is the workflow's CI result plus the SHA pin, not branch protection. A narrow post-enable race remains. Same workflow-file limitation. |
| **C. Native auto-merge + protected `main`** | As B, plus a ruleset requiring a PR and the `CI` check | Allow auto-merge; ruleset; a bypass-capable deploy credential (GitHub App or admin PAT) because Actions cannot bypass | Strongest: every PR must pass `CI`. More setup; the deploy bump must be pushed with the bypass identity (or land via a PR), otherwise deploys fail. Same workflow-file limitation. |
| **D. Scheduled direct-to-main** | A scheduled workflow installs latest npm versions, builds, commits to `main` | `contents: write`; no PR or protection | Fallback when PR automation is unavailable. No review/PR. A `GITHUB_TOKEN` push does not trigger `deploy-pages.yml`. Does not update OpenCV. |
| **E. Manual merge** | Dependabot opens PRs; a human merges when green | None beyond `CI` | Zero merge machinery; a human every time. |

### Option A - direct merge after CI (recommended)

Set the repository variable `DEPENDABOT_DIRECT_MERGE` to `true`
(Settings -> Secrets and variables -> Actions -> Variables -> New repository
variable). When `CI` succeeds for a Dependabot PR, the workflow runs:

```bash
gh pr merge --squash --delete-branch --match-head-commit "$RUN_SHA" <pr>
```

`--match-head-commit` is the important part: it refuses the merge if the PR
head moved after CI ran, so a Dependabot rebase cannot slip an untested commit
onto `main`. This path needs no "Allow auto-merge" setting, no ruleset, and no
extra secret. It leaves `deploy-pages.yml`'s `GITHUB_TOKEN` push unaffected.

It still leaves a normal PR record (the merge is squashed) and only runs after
a green `CI` run for that exact PR head.

#### Workflow-file PRs and `DEPENDABOT_MERGE_TOKEN`

`GITHUB_TOKEN` cannot merge a PR that changes `.github/workflows/**` (it cannot
hold the `workflows` permission). The `github-actions` Dependabot ecosystem
produces exactly such PRs. By default the workflow detects that and skips them
with a notice, leaving them for a manual merge.

To automate those too, create a repository secret `DEPENDABOT_MERGE_TOKEN`
with **Contents: write**, **Pull requests: write**, and **Workflows: write**
(a fine-grained PAT, or a GitHub App installation token). Both merge paths use
it when present. The token is only used to call `gh pr merge`; no PR code is
checked out.

### Option B - native auto-merge without a ruleset

Enable Settings -> General -> Pull requests -> **Allow auto-merge**. With
`DEPENDABOT_DIRECT_MERGE` unset, the workflow calls:

```bash
gh pr merge --auto --squash --match-head-commit "$RUN_SHA" <pr>
```

after `CI` succeeds. With no required checks, GitHub merges immediately once
auto-merge is enabled; because the workflow enables it only after a green CI
run and pins the SHA, the practical gate is still the CI run. The race window
between the SHA check and the merge being applied is small but non-zero; use
Option A for an atomic merge, or Option C if you want required checks.

If "Allow auto-merge" is off, the job fails with an explicit pointer to
Option A rather than silently doing nothing.

### Option C - native auto-merge with protected `main`

This is Option B plus a ruleset. It is the only option that makes required
checks apply to every PR, but it interacts with `deploy-pages.yml`.

1. Enable **Allow auto-merge** and **Allow squash merging**.
2. Add a ruleset (Settings -> Rules -> Rulesets -> New branch ruleset):
   - target `main`;
   - "Require a pull request before merging" (0 approvals is fine for a solo
     repo);
   - "Require status checks to pass" and add **`CI`**;
   - leave "Require branches to be up to date" off unless you accept a
     Dependabot rebase after every deploy bump.
3. Make the deploy bump able to bypass the ruleset. **GitHub Actions is not an
   eligible bypass actor**; eligible actors are repository roles, teams,
   GitHub Apps, deploy keys, and Dependabot. Pick one:
   - **Admin PAT (simplest):** create a fine-grained PAT owned by a repository
     admin with Contents: write, store it as the `DEPLOY_TOKEN` secret, and add
     "Repository admin" to the ruleset bypass list with "Always allow". The
     deploy workflow uses `secrets.DEPLOY_TOKEN` when present.
   - **GitHub App:** create an app with Contents: write, install it on this
     repository, add the app to the bypass list ("Always allow"), mint an
     installation token in `deploy-pages.yml` (for example with
     `actions/create-github-app-token`), and use that token for checkout/push.
   - **Bump via PR:** change `deploy-pages.yml` to open/merge the version bump
     as a PR so it satisfies the PR and check rules.
   Without one of these, the bump push is rejected with GH013 and deployment
   stops. App/PAT pushes do trigger workflows, but the existing `[skip ci]`
   commit marker and the deploy build job's guard prevent a second deploy.
4. If you also want `github-actions` PRs to auto-merge, set
   `DEPENDABOT_MERGE_TOKEN` as described under Option A. A `GITHUB_TOKEN`
   cannot merge workflow-file changes even when the ruleset allows the merge.

> Do not add "GitHub Actions" to the bypass list: it is a platform identity,
> not an installable GitHub App, and the ruleset API/UI rejects it.

### Option D - scheduled direct-to-main (not provided)

This repository does not ship a scheduled bump workflow. If PR automation is
unavailable and you want fully hands-off updates, add one, for example
`.github/workflows/dependabot-bump.yml`:

```yaml
name: Scheduled npm bump

on:
  schedule:
    - cron: "17 6 * * 1"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  bump:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v6
        with:
          node-version: "24"
          cache: npm
      - run: npm ci
      # npm update does nothing for exact pins; install latest explicitly.
      - run: npm install --save-exact qrcode@latest
      - run: npm install --save-exact --save-dev @types/qrcode@latest tsx@latest typescript@latest vite@latest
      - run: npm run build
      - name: Commit and push
        run: |
          set -euo pipefail
          if git diff --quiet; then
            echo "No dependency changes."
            exit 0
          fi
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add package.json package-lock.json
          git commit -m "chore(deps): scheduled dependency bump"
          git pull --rebase --autostash origin main
          git push origin HEAD:main
```

Caveats before choosing Option D:

- A push made with `GITHUB_TOKEN` does **not** trigger other workflows, so
  `deploy-pages.yml` will not run for that commit. Either dispatch it
  manually after the push (`gh workflow run "Deploy site to GitHub Pages"`) or
  push with a fine-grained PAT that has `contents: write`.
- `deploy-pages.yml` also pushes its own patch bump on every push to `main`.
  Expect races between the two; `git pull --rebase` before pushing, and avoid
  running the scheduled job exactly when a deploy is in flight.
- There is no review and no PR record. A broken dependency lands directly on
  `main` if `npm run build` did not catch it.
- It does not update `tests/opencv-qr-test/requirements.txt`. OpenCV bumps stay deliberate and go
  through PR CI because of the byte/raster gate.
- The OpenCV verification scripts require `uv`; add the install step from
  `ci.yml` if you also want to run them here.

To stop Dependabot from opening PRs once a scheduled workflow owns updates,
remove or comment out the `npm` entry in `.github/dependabot.yml`.

### Option E - manual merge

Merge Dependabot PRs by hand when `CI` is green. If you choose this, delete or
do not merge `.github/workflows/dependabot-auto-merge.yml`: otherwise every
successful Dependabot CI run will run that workflow and fail with the
"auto-merge is disabled" error annotation.

## Required repository settings

Settings paths are for the repository's own settings (not organization-level
policy). Everything below is free for a public repository. Choose an option
from the table above first.

**Common**

1. **Settings -> Pages -> Source: GitHub Actions.** Already required by
   `deploy-pages.yml`; listed here because merges flow into that deploy.
2. **Get `ci.yml` (and, for options A-C, `dependabot-auto-merge.yml`) onto
   `main`.** `workflow_run` does not fire for a workflow file that exists only
   on a non-default branch.
3. **Settings -> General -> Pull requests -> Allow squash merging.** Both merge
   paths use `gh pr merge --squash`.

**Option A - direct merge after CI (recommended)**

4. **Settings -> Secrets and variables -> Actions -> Variables -> New
   repository variable**: `DEPENDABOT_DIRECT_MERGE` = `true`.
   This turns on `gh pr merge --squash --match-head-commit "$RUN_SHA"` after a
   green CI run. No "Allow auto-merge" setting and no ruleset are needed.
5. **Optional: `DEPENDABOT_MERGE_TOKEN` secret** with Contents: write, Pull
   requests: write, and Workflows: write. Only needed for `github-actions`
   Dependabot PRs, which modify `.github/workflows/**`; without it those PRs
   are skipped for manual merge.

**Option B - native auto-merge without a ruleset**

4. **Settings -> General -> Pull requests -> Allow auto-merge.**
5. **Optional `DEPENDABOT_MERGE_TOKEN`** as above.

Do not add a ruleset that requires PRs/checks unless you also follow Option C's
deploy instruction; otherwise the deploy bump push is rejected.

**Option C - native auto-merge with protected `main`**

4. **Allow auto-merge** and **Allow squash merging**.
5. **Ruleset on `main`** (Settings -> Rules -> Rulesets -> New branch
   ruleset):
   - target `main`;
   - "Require a pull request before merging" (0 approvals is fine for a solo
     repo);
   - "Require status checks to pass" and add **`CI`** (selectable after the
     workflow has run at least once);
   - leave "Require branches to be up to date" off unless you accept a
     Dependabot rebase after every deploy bump;
   - add a bypass actor that the deploy push can actually authenticate as:
     **Repository admin** (with an admin PAT) or an installed **GitHub App**.
     GitHub Actions is not eligible.
6. **Give `deploy-pages.yml` the bypass identity.** Set the `DEPLOY_TOKEN`
   secret to an admin fine-grained PAT with Contents: write and add
   "Repository admin" to the bypass list, or mint a GitHub App token and use
   it for checkout/push. Without this, the bump push fails with GH013 and
   deploys stop. Alternatively, change the deploy workflow to land the bump via
   a PR.
7. **Optional `DEPENDABOT_MERGE_TOKEN`** as above for `github-actions` PRs.
   Note that the ruleset's bypass does not help: the merge token itself needs
   the `workflows` scope.

**Option D - scheduled direct-to-main**

4. **`contents: write`** for the scheduled workflow (declared in its YAML). No
   "Allow auto-merge" setting and no branch protection are needed. If you use a
   PAT instead of `GITHUB_TOKEN` so the push triggers `deploy-pages.yml`,
   configure it as a repository secret yourself.

**Option E - manual merge**

Do not merge `.github/workflows/dependabot-auto-merge.yml` (or delete it).
Otherwise every successful Dependabot CI run will run it and fail if
auto-merge is disabled.

**Troubleshooting / not required**

8. Settings -> Actions -> General -> Workflow permissions: the workflows
   declare their own `permissions:`, which normally suffices even when the
   repository default is read-only. If your organization policy blocks write
   tokens, change the default to "Read and write permissions" or allow the
   declared scopes.
9. Settings -> Actions -> General -> "Allow GitHub Actions to create and
   approve pull requests" is **not** needed: these workflows do not create or
   approve PRs.
10. Repository labels: `dependencies`, `npm`, `github-actions`, `python` are
    applied to Dependabot PRs. Create them if you want to filter by them.
11. `DEPLOY_TOKEN` and `DEPENDABOT_MERGE_TOKEN` are read by Actions workflows,
    so they are **Actions** secrets (Settings -> Secrets and variables ->
    Actions), not Dependabot secrets.

## Running the checks locally

```bash
# Normal PR checks
npm ci
npm run build

# OpenCV tooling checks (need uv: https://docs.astral.sh/uv/)
#   Windows PowerShell: irm https://astral.sh/uv/install.ps1 | iex
#   Linux/macOS:        curl -LsSf https://astral.sh/uv/install.sh | sh
npm run verify:opencv
```

Replicate the OpenCV gate for a change against `main`:

```bash
BASE=main
git fetch origin "$BASE"

if ! git diff --name-only "origin/$BASE...HEAD" -- tests/opencv-qr-test/requirements.txt | grep -q .; then
  echo "tests/opencv-qr-test/requirements.txt unchanged; only the build runs."
else
  NEW_WHEEL="$(sed -n 's/^opencv-contrib-python-headless==//p' tests/opencv-qr-test/requirements.txt)"
  if git cat-file -e "origin/$BASE:tests/opencv-qr-test/requirements.txt" 2>/dev/null; then
    OLD_WHEEL="$(git show "origin/$BASE:tests/opencv-qr-test/requirements.txt" \
      | sed -n 's/^opencv-contrib-python-headless==//p')"
  else
    # The PR adds tests/opencv-qr-test/requirements.txt: CI treats the new pin as the baseline.
    OLD_WHEEL="$NEW_WHEEL"
  fi

  # Drop the 4th wheel component to get the OpenCV source tag.
  OLD_TAG="${OLD_WHEEL%.*}"
  NEW_TAG="${NEW_WHEEL%.*}"

  # CI passes its read-only token to raise the public API rate limit.
  GITHUB_TOKEN="$(gh auth token)" \
    node tests/opencv-release-diff.mjs --from "$OLD_TAG" --to "$NEW_TAG"
  node tests/verify-opencv-aruco-bytes.mjs --opencv-version "$NEW_WHEEL"
  npm run verify:opencv-raster
fi
```

The `sed` lines match the common `name==version` form; CI's `awk` parser also
tolerates extras, spaces around `==`, and environment markers.

Exit codes for both OpenCV scripts are 0 = pass, 1 = intentional failure
(review / regenerate), 2 = indeterminate or infrastructure error. The scripts
accept `--help`; the release diff also accepts `--json`.

Regenerating and verifying the dictionary after an OpenCV upgrade is covered in
[aruco-dictionary.md](aruco-dictionary.md) (`tests/opencv-dict-sync.ps1` /
`tests/opencv-dict-sync.sh` do export + raster verification in one step).
