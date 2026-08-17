# Changelog

## [0.3.0](https://github.com/say8425/headerlab/compare/cli-v0.2.0...cli-v0.3.0) (2026-08-17)


**This release changes nothing about how the CLI behaves.** Its code is byte-for-byte `0.2.0`; what moved is this package's README and the test that guards it.

It exists because a cross-cutting commit touched `packages/headerlab/README.md` along with 27 files belonging to the extension, and release-please attributes a commit to every package it touches. The entry generated here originally read *"name the agent bridge, switch its control, and stop losing failed requests"* — the extension's work, credited to this package. That was wrong and is corrected below.

### Documentation

* document `--human`, which shipped in `0.2.0` with no mention in this README: it is the inverse of `--json`, forces the human-readable form through a pipe, and is refused alongside `--json` with exit 2 ([b134ba4](https://github.com/say8425/headerlab/commit/b134ba48ca81550c74a07f787be0fdba431714a4))
* repoint the agent-bridge link at `docs/agent-bridge.md`, which is where that material now lives ([4b22181](https://github.com/say8425/headerlab/commit/4b22181))
* drop the ModHeader paragraph, keeping the sentence that says why `npm audit signatures` is worth running ([b134ba4](https://github.com/say8425/headerlab/commit/b134ba48ca81550c74a07f787be0fdba431714a4))

### Tests

* assert the runnable commands in the five agent-bridge documents are byte-identical, and that the extracted command list is non-empty — the second is the guard that stops five empty lists comparing equal and passing ([4b22181](https://github.com/say8425/headerlab/commit/4b22181))

### Note on versioning

`0.3.0` is a minor bump for a documentation change, which is not what the version says. The bump follows from the same attribution: release-please read the cross-cutting commit's `feat:` type as this package's. `exclude-paths` now keeps a prose-only commit from proposing a release, but it cannot retroactively re-scope one that also touched code elsewhere.

## [0.2.0](https://github.com/say8425/headerlab/compare/cli-v0.1.2...cli-v0.2.0) (2026-08-16)


### ⚠ BREAKING CHANGES

* five changes to the CLI's contract.

### Features

* rework the CLI to follow clig.dev ([46514f9](https://github.com/say8425/headerlab/commit/46514f94f64e02865a89a242a0cf991b717d3c72))

## [0.1.2](https://github.com/say8425/headerlab/compare/cli-v0.1.1...cli-v0.1.2) (2026-08-14)


### Bug Fixes

* **headerlab:** stop the README promising provenance the first release will not have ([#26](https://github.com/say8425/headerlab/issues/26)) ([49d16b3](https://github.com/say8425/headerlab/commit/49d16b391a29b2cdb5494d69712ffb90c9bcb2f6))

## [0.1.1](https://github.com/say8425/headerlab/compare/cli-v0.1.0...cli-v0.1.1) (2026-08-14)


### Bug Fixes

* **headerlab:** stop the README sending npm users to files they do not have ([#23](https://github.com/say8425/headerlab/issues/23)) ([8110753](https://github.com/say8425/headerlab/commit/81107532cfabdf2ce5d8c9e8f31481fb974d69ee))

## 0.1.0 (2026-08-14)


### Features

* the agent bridge — a CLI on npm and a skill that drive HeaderLab ([#17](https://github.com/say8425/headerlab/issues/17)) ([67760be](https://github.com/say8425/headerlab/commit/67760be95aed6853478321ea7f77f53bc872955b))
