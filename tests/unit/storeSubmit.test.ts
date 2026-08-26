import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The release path, guarded where YAML cannot guard itself.
 *
 * These read the workflow files as text, the way `tests/unit/workspace.test.ts`
 * already reads `ci.yml` — there is no YAML parser in this tree and adding one
 * for four assertions would buy a dependency to check a dependency rule.
 *
 * Each of these defends a failure that is silent by construction. None of them
 * can tell you the store accepted anything; that is `scripts/store-submit.mjs`'s
 * job, and the only thing that ever proves it is a real run.
 */

const releasePlease = readFileSync('.github/workflows/release-please.yml', 'utf8');
const storeSubmit = readFileSync('.github/workflows/store-submit.yml', 'utf8');

/**
 * The name is pinned rather than merely present, and this is the sharpest guard
 * in the file. Referencing an environment that does not exist does not fail:
 * GitHub creates one with that name, with no protection rules and no secrets,
 * and the job runs ungated with an empty key. `chrome-webstore` against
 * `chrome-web-store` is the whole distance between the gate holding and the gate
 * never having existed, and nothing in the Actions UI says which happened.
 */
describe('the store submission is gated by an environment', () => {
  it('names exactly the environment the signing key is stored in', () => {
    const declared = [...storeSubmit.matchAll(/^\s*environment:\s*(\S+)\s*$/gm)].map((m) => m[1]);
    expect(declared).toEqual(['chrome-web-store']);
  });

  /**
   * Environment secrets are readable only by a job that declares the
   * environment. A job that reads the key without declaring it gets an empty
   * string rather than an error, so "every key reference is inside the gated
   * job" is the property worth pinning — not "the key is referenced somewhere".
   */
  it('reads the signing key only in the workflow that declares that environment', () => {
    expect(releasePlease).not.toContain('CRX_SIGNING_KEY');
    expect(releasePlease).not.toContain('CWS_SERVICE_ACCOUNT_JSON');
    expect(storeSubmit).toContain('environment: chrome-web-store');
  });

  /**
   * An unset secret arrives as `""`. Without an explicit refusal, Chrome is
   * handed `--pack-extension-key=` and the first news of it is a rejection from
   * the store, by which point the tag and the GitHub release both exist.
   */
  it('refuses to run before it has looked at the key', () => {
    const refusal = storeSubmit.indexOf('Refuse to run without a real signing key');
    const staging = storeSubmit.indexOf('Stage the signing key');
    const signing = storeSubmit.indexOf('scripts/pack-crx.mjs');
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(staging);
    expect(staging).toBeLessThan(signing);
  });

  /**
   * release-please cuts the tag inside its own step, so everything after it runs
   * with the release already irreversible. The retry path therefore cannot be
   * "release again" — it has to be re-running this workflow against the tag that
   * already exists, which is what `workflow_dispatch` is for.
   */
  it('can be re-run by hand against a tag that already exists', () => {
    expect(storeSubmit).toContain('workflow_call:');
    expect(storeSubmit).toContain('workflow_dispatch:');
  });

  /**
   * `on: release` would never fire — release-please creates the release with the
   * default GITHUB_TOKEN, and by GitHub's loop-prevention rule that event starts
   * no run. A workflow wired that way looks correct and submits nothing, for
   * every release, silently.
   */
  it('is not wired to an event that a GITHUB_TOKEN release cannot raise', () => {
    expect(storeSubmit).not.toMatch(/^\s*release:\s*$/m);
    expect(storeSubmit).not.toMatch(/^\s*tags:/m);
  });
});

/**
 * The ordering fix, and the reason it is a test rather than a comment.
 *
 * Every failure downstream of the release-please step lands on a tag that cannot
 * be withdrawn — this repository has been there twice, with `EOTP` and then
 * `EUSAGE`. Moving the checks above that step is what removes the entire build
 * failure class from the post-tag window, and a later edit that "tidies" them
 * back down would restore it without changing a single line of behaviour.
 */
describe('everything that can fail runs before the tag exists', () => {
  const cut = releasePlease.indexOf('googleapis/release-please-action@');

  it('checks and builds above the step that cuts the tag', () => {
    expect(cut).toBeGreaterThan(-1);
    expect(releasePlease.indexOf('run: pnpm check')).toBeLessThan(cut);
    expect(releasePlease.indexOf('run: pnpm zip')).toBeLessThan(cut);
  });

  /**
   * Unconditional as well as early. Gating them on `steps.release.outputs.*`
   * would be a contradiction — those outputs do not exist until the step they
   * are meant to run before has already run.
   */
  it('runs them on every push rather than guessing whether this one releases', () => {
    const before = releasePlease.slice(0, cut);
    const checkLine = before.indexOf('run: pnpm check');
    const afterCheck = before.slice(checkLine, checkLine + 200);
    expect(afterCheck).not.toContain('if:');
  });

  /** The third-party action stays pinned to a commit, not a tag. */
  it('keeps the one third-party action on a SHA', () => {
    expect(releasePlease).toMatch(/googleapis\/release-please-action@[0-9a-f]{40}/);
  });
});
