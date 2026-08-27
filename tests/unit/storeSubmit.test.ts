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
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
// The composite action is local, but the actions it names are not — and it is
// where four of this repository's six jobs actually pick their versions up.
const setup = readFileSync('.github/actions/setup/action.yml', 'utf8');

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
   *
   * Comments are stripped before looking, and the whole step is read rather than
   * a fixed slice. An earlier version scanned 200 characters after the `run:`
   * line, which in this file is mostly prose: an `if:` written in a comment
   * would have failed it, and a re-gated `pnpm zip` would have passed.
   */
  it.each(['pnpm check', 'pnpm zip'])('runs %s on every push, not only on a release', (command) => {
    const steps = releasePlease
      .slice(0, cut)
      .split('\n')
      .filter((line) => !/^\s*#/.test(line));
    const start = steps.findIndex((line) => line.includes(`run: ${command}`));
    expect(start, `${command} does not run before the tag is cut`).toBeGreaterThan(-1);
    const rest = steps.slice(start + 1);
    const end = rest.findIndex((line) => /^\s*- /.test(line));
    const body = (end === -1 ? rest : rest.slice(0, end)).join('\n');
    expect(body).not.toContain('if:');
  });
});

/**
 * The wiring between the two workflows, which nothing else can see.
 *
 * Without this, deleting the `store-submit` job from `release-please.yml`
 * entirely — or breaking what it passes — leaves every other test in this
 * repository green while releases quietly stop reaching the store. That is the
 * exact shape of silent failure this whole change exists to remove, so it gets
 * a guard rather than a comment.
 */
describe('the release calls the store submission', () => {
  it('declares the three outputs the store job is given', () => {
    for (const output of ['extension_released', 'extension_tag', 'extension_version']) {
      expect(releasePlease).toContain(`${output}:`);
    }
  });

  it('calls the reusable workflow, after the release job, only when the extension released', () => {
    const job = releasePlease.slice(releasePlease.indexOf('  store-submit:'));
    expect(job).toContain('needs: release-please');
    expect(job).toContain('uses: ./.github/workflows/store-submit.yml');
    expect(job).toContain('needs.release-please.outputs.extension_released');
  });

  it('passes the tag and the version the store job requires as inputs', () => {
    const job = releasePlease.slice(releasePlease.indexOf('  store-submit:'));
    expect(job).toContain('tag: ${{ needs.release-please.outputs.extension_tag }}');
    expect(job).toContain('version: ${{ needs.release-please.outputs.extension_version }}');

    // Anchored to the key's own indentation, not a substring search. `tag:` is
    // inside `release_tag:`, so a bare `toContain` would stay green through a
    // rename on the callee's side — the exact drift this assertion exists for.
    // Two of each: one per trigger.
    for (const input of ['tag', 'version']) {
      expect(storeSubmit.match(new RegExp(`^ {6}${input}:$`, 'gm'))).toHaveLength(2);
    }
  });

  /**
   * The checkout defaults to the tag, and can be overridden.
   *
   * Both halves are load-bearing and they guard opposite mistakes. Without the
   * tag default, a dispatch-driven retry would check out `main` and die at the
   * signature, because `pack-crx.mjs` refuses an archive whose manifest version
   * disagrees with `package.json`. Without the override, a failure *in the
   * scripts* could never be fixed: the checkout supplies only the scripts — the
   * CRX's payload comes from the release's own zip — so a tag-pinned re-run
   * replays the same broken script forever, and the likeliest such failure is
   * `UPLOADABLE_STATES` refusing a state the store really does use.
   *
   * Pinning the whole expression rather than either operand is what makes
   * dropping one of them fail here.
   */
  it('signs the released code by default, and can be pointed elsewhere to fix a script', () => {
    expect(storeSubmit).toContain('ref: ${{ inputs.ref || inputs.tag }}');
    // Declared under both triggers, so the expression resolves either way.
    expect(storeSubmit.match(/^ {6}ref:$/gm)).toHaveLength(2);
  });

  /**
   * Every action is a floating major, third-party included (owner's call,
   * 2026-08-27). Pinned so a well-meaning edit back to a SHA — or forward to an
   * exact `@v5.0.0` — has to argue with CLAUDE.md's CI section rather than land
   * quietly, since that section records the trade this repository accepted.
   */
  it('targets the latest major of every action, never a commit or an exact tag', () => {
    // Every workflow, not just this change's: the rule is repo-wide, and a rule
    // checked on one file is a rule the next file gets to ignore. Local actions
    // and reusable workflows (`./…`) carry no version and are skipped.
    const refs = [ci, releasePlease, storeSubmit, setup]
      .flatMap((yaml) => [...yaml.matchAll(/^\s*-?\s*uses:\s*(\S+)\s*$/gm)])
      .map((match) => match[1] ?? '')
      .filter((ref) => !ref.startsWith('./'));
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref, `${ref} is not a bare major`).toMatch(/@v\d+$/);
    }
  });
});
