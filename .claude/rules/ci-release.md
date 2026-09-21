---
paths:
  - ".github/**"
  - "release-please-config.json"
  - ".release-please-manifest.json"
  - "CHANGELOG.md"
  - "packages/headerlab/CHANGELOG.md"
  - "packages/headerlab/package.json"
  - "packages/plugin/.claude-plugin/**"
  - "packages/plugin/.codex-plugin/**"
  - "tests/unit/{workspace,storeSubmit}.test.ts"
---

# CI and release

## CI (`ci.yml`)

- Six jobs, one per check, each `name:` the check it performs: typecheck, lint, format, unit,
  package tests (node:test), e2e. Separate jobs report every failure per push and name the
  failing check in the PR.
- Shared setup is the local composite action `.github/actions/setup`. `corepack enable` runs
  after setup-node so the shims land in the job's Node, and setup-node's `cache: pnpm` is
  unusable (it resolves the store before pnpm exists) — hence `pnpm store path` plus
  `actions/cache`.
- **Every action, third-party included, is a floating major** (`actions/checkout@v7`,
  `googleapis/release-please-action@v5`) — owner's call, 2026-08-27, pinned by
  `tests/unit/storeSubmit.test.ts`. The accepted cost: a moved upstream tag on
  `release-please-action` reaches the job holding `contents: write`, `pull-requests: write`
  and the `id-token: write` that publishes to npm; only a SHA would foreclose that. No
  dependabot, so major bumps stay manual.
- What keeps that trade acceptable for `ci.yml`: it holds only `contents: read`, every checkout
  sets `persist-credentials: false`, and it never interpolates `github.event.*`. Breaking any
  of the three reopens the pinning decision — the test above will not notice.
- The workflow files carry much of their reasoning in comments at the point of use (step
  ordering, output syntax, recovery paths). Keep those comments; this file does not repeat them.
- Release branches do get `ci.yml` runs on `pull_request`, sometimes needing approval by hand.

## Release (`release-please.yml`, on push to `main`)

- release-please opens one release PR per package (`separate-pull-requests: true`).
- **Everything that can fail runs before the release-please step**, unconditionally, on every
  push to `main`: `pnpm check` and `pnpm zip`. The step itself tags and releases when a release
  PR was merged; after it, only the gated steps run — attaching the Chrome, Firefox and sources
  archives, `npm publish`, and the `cws-submit.yml` / `amo-submit.yml` calls (neither waits for
  the other) — all with the tag already cut, so a failure there leaves a released version. Put
  any new step that can fail above the release-please step: npm's `EUSAGE` and `EOTP` refusals
  once arrived after the tag. `pnpm check` is in this job because `ci.yml` fires on the same
  push and neither run waits for the other.
- The release job checks out unconditionally because the next step is a local action.
- The extension stays at the repository root: release-please prefixes every output with the
  package path once it is not `.`, which would make conditions in `release-please.yml` evaluate
  false — a release with no check and no artifacts, nothing red.
- Tags are `extension-v<x.y.z>` and `cli-v<x.y.z>`. `component` is what titles a release
  (`extension: v1.8.0`); left unset it defaults to the package name, which is `headerlab`.

### Which commits reach which package

- `exclude-paths` skips a commit only when **every** file it touches is excluded. The root
  package excludes `packages/headerlab`, `README.md`, `CLAUDE.md`, `.claude` and `docs`;
  `tests/unit/workspace.test.ts` derives the sibling exclusions from the config and pins the
  prose ones. `packages/plugin` is deliberately not excluded: it is versioned through the CLI's
  `extra-files`, so excluding it would leave a skill-only commit in no changelog.
- **Only directory entries take effect.** release-please 17.6.0 matches an exclude path with
  `file.indexOf(\`${path}/\`) === 0`, so the file entries (`README.md`, `CLAUDE.md`, and the CLI's
  `packages/headerlab/README.md`) currently match nothing. Unresolved; do not rely on them.
- A `BREAKING CHANGE:` footer applies to every package the squash-merged commit touches — a CLI
  break once proposed `extension 2.0.0`. See what a commit touches outside the CLI with
  `git show --name-only --format='' <sha> | sed '/^$/d' | grep -v '^packages/headerlab/'`.
  Pin the other package with a **line-initial `Release-As: <version>` in the commit message**:
  squash merges use `COMMIT_MESSAGES`, so the PR body never reaches the commit, and a
  mid-sentence mention is not a footer. Verify with
  `git log -1 --format=%B <ref> | grep -c '^Release-As:'`, then confirm the release PR
  regenerated with the new number. Do not use the deprecated `release-as` config key.
- `bump-minor-pre-major: true` keeps a breaking change on the `0.x` CLI a minor. release-please
  drops unknown config keys without a log line, so spell keys from the schema.
- **A wrong changelog is two fixes**: `CHANGELOG.md` on the release PR branch, and the GitHub
  release body, which release-please builds from its own notes — after release, `gh release
  edit <tag> --notes-file <file>` (keeps the release id and its assets).
- Merging one release PR makes the other `CONFLICTING` on `.release-please-manifest.json`, and
  release-please does not rebase it. Rebase by hand so the manifest holds **both** new
  versions, e.g. `{".":"1.2.0","packages/headerlab":"0.2.0"}`; taking either side drops one.
- Never delete a release to get rid of its tag: that destroys its assets and their download
  counts. Move it to another tag in place instead (`PATCH …/releases/{id}` accepts `tag_name`):
  push and verify the new tag, `gh release edit <old> --tag <new> --title …`, then delete the
  old tag. Deleting first orphans the release; and a missing destination tag would be created
  silently at `target_commitish`, which is why it is pushed first. Rewrite compare links in
  the body in the same pass.
- Count tags and releases with `git tag | wc -l` and `gh release list`; do not write the number
  down.

### npm publishing

- CI publishes `headerlab` through OIDC trusted publishing (this repository and this workflow
  file; that is what `id-token: write` is for). There is no npm token.
- `--provenance` is redundant under trusted publishing and kept on purpose: it fails the job
  loudly if signing ever stops, and the package README promises every release verifies with
  `npm audit signatures`.
- Only the first version was published by hand, because npm cannot configure a trusted
  publisher for a package that does not exist. Never publish by hand again.

## Store jobs

- `cws-submit.yml` and `amo-submit.yml` are `workflow_call` jobs of the release run, never
  `on: release` — a release created with the default `GITHUB_TOKEN` triggers no workflow. That
  also keeps `GITHUB_REF` at `refs/heads/main`, which the environments' branch rules name.
- Each is gated by its own environment: `chrome-web-store` (secret `CRX_SIGNING_KEY`) and
  `firefox-amo` (secrets `FIREFOX_JWT_ISSUER`, `FIREFOX_JWT_SECRET`, variable
  `FIREFOX_CHANNEL`). A typo in an environment name silently creates an unprotected one;
  `tests/unit/storeSubmit.test.ts` pins both names, that each credential is read only in its
  own workflow, and that the Chrome job names `*-chrome.zip` (a bare `*.zip` would make
  `unzip` and `pack-crx.mjs` take the other archives as member patterns).
- **Recovery is `workflow_dispatch` against the same tag; never re-cut a version.** Transient
  failure: re-run. A bug in the scripts: pass `ref`, since the checkout supplies only the
  scripts and the payload always comes from the release's own zip. `ref: main` works only while
  `main` still carries the tag's version. `docs/store/checklist.md` §10 has the table.
- `main` refuses direct pushes (the ruleset's `pull_request` rule) but requires no review: with
  one collaborator a required review can only be bypassed. `.github/CODEOWNERS` records what to
  set once a second maintainer exists.
