import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GECKO_ID } from '@/scripts/lib/amo.mjs';
import { readBuildFile } from '../support/build';

/**
 * The release path, guarded where YAML cannot guard itself.
 *
 * These read the workflow files as text, the way `tests/unit/workspace.test.ts`
 * already reads `ci.yml` — there is no YAML parser in this tree and adding one
 * for these assertions would buy a dependency to check a dependency rule.
 *
 * Two stores now, two reusable workflows, each gated by its own environment.
 * Each assertion defends a failure that is silent by construction. None of
 * them can tell you a store accepted anything; that is `scripts/store-submit.mjs`'s
 * and `scripts/amo-submit.mjs`'s job, and the only thing that ever proves it is
 * a real run.
 */

const releasePlease = readFileSync('.github/workflows/release-please.yml', 'utf8');
const cwsSubmit = readFileSync('.github/workflows/cws-submit.yml', 'utf8');
const amoSubmit = readFileSync('.github/workflows/amo-submit.yml', 'utf8');
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
// The composite action is local, but the actions it names are not — and it is
// where most of this repository's jobs actually pick their versions up.
const setup = readFileSync('.github/actions/setup/action.yml', 'utf8');
const gitignore = readFileSync('.gitignore', 'utf8');

const STORES = [
  ['cws-submit.yml', cwsSubmit],
  ['amo-submit.yml', amoSubmit],
] as const;

const environments = (yaml: string): string[] =>
  [...yaml.matchAll(/^\s*environment:\s*(\S+)\s*$/gm)].map((m) => m[1]!);

/** The body of one top-level job in release-please.yml, up to the next job. */
const job = (name: string): string => {
  const start = releasePlease.indexOf(`  ${name}:\n`);
  expect(start, `${name} job is missing from release-please.yml`).toBeGreaterThan(-1);
  const rest = releasePlease.slice(start + name.length + 4);
  const end = rest.search(/^  \S/m);
  return end === -1 ? rest : rest.slice(0, end);
};

/**
 * The name is pinned rather than merely present, and this is the sharpest guard
 * in the file. Referencing an environment that does not exist does not fail:
 * GitHub creates one with that name, with no protection rules and no secrets,
 * and the job runs ungated with empty credentials. `firefox-addons` against
 * `firefox-amo` is the whole distance between the gate holding and the gate
 * never having existed, and nothing in the Actions UI says which happened.
 */
describe('each store submission is gated by its own environment', () => {
  it('names exactly the environment its credentials are stored in', () => {
    expect(environments(cwsSubmit)).toEqual(['chrome-web-store']);
    expect(environments(amoSubmit)).toEqual(['firefox-amo']);
  });

  /**
   * Environment secrets are readable only by a job that declares the
   * environment. A job that reads a credential without declaring it gets an
   * empty string rather than an error, so "every reference is inside the job
   * that declares that environment" is the property worth pinning — and with
   * two environments, "not inside the other one" is half of it.
   */
  it('reads each credential only in the workflow that declares its environment', () => {
    const chrome = ['CRX_SIGNING_KEY', 'CWS_SERVICE_ACCOUNT_JSON'];
    const firefox = ['FIREFOX_JWT_ISSUER', 'FIREFOX_JWT_SECRET'];
    for (const name of [...chrome, ...firefox]) expect(releasePlease).not.toContain(name);
    for (const name of chrome) {
      expect(cwsSubmit).toContain(name);
      expect(amoSubmit).not.toContain(name);
    }
    for (const name of firefox) {
      expect(amoSubmit).toContain(name);
      expect(cwsSubmit).not.toContain(name);
    }
  });

  /**
   * An unset secret arrives as `""`. Without an explicit refusal, Chrome is
   * handed `--pack-extension-key=` and the first news of it is a rejection from
   * the store, by which point the tag and the GitHub release both exist.
   */
  it('the Chrome job refuses to run before it has looked at the key', () => {
    const refusal = cwsSubmit.indexOf('Refuse to run without a real signing key');
    const staging = cwsSubmit.indexOf('Stage the signing key');
    const signing = cwsSubmit.indexOf('scripts/pack-crx.mjs');
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(staging);
    expect(staging).toBeLessThan(signing);
  });

  /**
   * Same shape for Firefox: an empty secret would reach `wxt submit` after the
   * checkout and the install, and a wrong channel would reach AMO. The refusal
   * comes first, then the download, then the one command that submits.
   */
  it('the Firefox job refuses before it downloads, and downloads before it submits', () => {
    const refusal = amoSubmit.indexOf('Refuse to run without real AMO credentials');
    const download = amoSubmit.indexOf('Take the archives from the release');
    const submit = amoSubmit.indexOf('scripts/amo-submit.mjs');
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(download);
    expect(download).toBeLessThan(submit);
  });

  /**
   * The channel has one resolution order and it is pinned as an expression:
   * the dispatch input, else the environment's variable, else listed. Dropping
   * the last operand would make an unset variable an empty channel, which the
   * refusal step catches — but only after a wasted release.
   */
  it('resolves the Firefox channel from the input, then the variable, then listed', () => {
    expect(amoSubmit).toContain("${{ inputs.channel || vars.FIREFOX_CHANNEL || 'listed' }}");
    expect(amoSubmit).toContain('FIREFOX_CHANNEL=$CHANNEL');
  });

  /**
   * release-please cuts the tag inside its own step, so everything after it runs
   * with the release already irreversible. The retry path therefore cannot be
   * "release again" — it has to be re-running the store workflow against the
   * tag that already exists, which is what `workflow_dispatch` is for.
   */
  it.each(STORES)('%s can be re-run by hand against a tag that already exists', (_, yaml) => {
    expect(yaml).toContain('workflow_call:');
    expect(yaml).toContain('workflow_dispatch:');
  });

  /**
   * `on: release` would never fire — release-please creates the release with the
   * default GITHUB_TOKEN, and by GitHub's loop-prevention rule that event starts
   * no run. A workflow wired that way looks correct and submits nothing, for
   * every release, silently.
   */
  it.each(STORES)('%s is not wired to an event a GITHUB_TOKEN release cannot raise', (_, yaml) => {
    expect(yaml).not.toMatch(/^\s*release:\s*$/m);
    expect(yaml).not.toMatch(/^\s*tags:/m);
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

  /**
   * Three archives now — Chrome, Firefox, and the sources archive AMO reviews —
   * and all three go on the release, so what Mozilla reviewed is what anyone
   * can download. The upload keeps the glob; the Chrome job below must not.
   */
  it('attaches every archive pnpm zip wrote', () => {
    expect(releasePlease).toContain('gh release upload "$TAG" .output/*.zip');
  });
});

/**
 * The wiring between the workflows, which nothing else can see.
 *
 * Without this, deleting either store job from `release-please.yml` — or
 * breaking what it passes — leaves every other test in this repository green
 * while releases quietly stop reaching that store. That is the exact shape of
 * silent failure this whole change exists to remove, so it gets a guard rather
 * than a comment.
 */
describe('the release calls both store submissions', () => {
  it('declares the three outputs the store jobs are given', () => {
    for (const output of ['extension_released', 'extension_tag', 'extension_version']) {
      expect(releasePlease).toContain(`${output}:`);
    }
  });

  it.each([
    ['cws-submit', 'cws-submit.yml', cwsSubmit],
    ['amo-submit', 'amo-submit.yml', amoSubmit],
  ])('calls %s after the release job, only when the extension released', (name, file, yaml) => {
    const body = job(name);
    expect(body).toContain('needs: release-please');
    expect(body).toContain(`uses: ./.github/workflows/${file}`);
    expect(body).toContain('needs.release-please.outputs.extension_released');
    expect(body).toContain('tag: ${{ needs.release-please.outputs.extension_tag }}');
    expect(body).toContain('version: ${{ needs.release-please.outputs.extension_version }}');

    // Anchored to the key's own indentation, not a substring search. `tag:` is
    // inside `release_tag:`, so a bare `toContain` would stay green through a
    // rename on the callee's side — the exact drift this assertion exists for.
    // Two of each: one per trigger.
    for (const input of ['tag', 'version']) {
      expect(yaml.match(new RegExp(`^ {6}${input}:$`, 'gm')), `${file} ${input}`).toHaveLength(2);
    }
  });

  /**
   * The checkout defaults to the tag, and can be overridden.
   *
   * Both halves are load-bearing and they guard opposite mistakes. Without the
   * tag default, a dispatch-driven retry would check out `main` and die at the
   * version check, because both submit scripts refuse an archive whose
   * manifest version disagrees with the one being submitted. Without the
   * override, a failure *in the scripts* could never be fixed: the checkout
   * supplies only the scripts — the payload comes from the release's own
   * archives — so a tag-pinned re-run replays the same broken script forever.
   *
   * Pinning the whole expression rather than either operand is what makes
   * dropping one of them fail here.
   */
  it.each(STORES)(
    '%s signs the released code by default, and can be pointed elsewhere',
    (_, yaml) => {
      expect(yaml).toContain('ref: ${{ inputs.ref || inputs.tag }}');
      // Declared under both triggers, so the expression resolves either way.
      expect(yaml.match(/^ {6}ref:$/gm)).toHaveLength(2);
    },
  );

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
    const refs = [ci, releasePlease, cwsSubmit, amoSubmit, setup]
      .flatMap((yaml) => [...yaml.matchAll(/^\s*-?\s*uses:\s*(\S+)\s*$/gm)])
      .map((match) => match[1] ?? '')
      .filter((ref) => !ref.startsWith('./'));
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref, `${ref} is not a bare major`).toMatch(/@v\d+$/);
    }
  });
});

/**
 * Three archives changed what a glob means. `unzip` and `pack-crx.mjs` both
 * take one archive; handed `.output/*.zip` with three present, the shell
 * expands it in string order and the second and third arguments become member
 * patterns — the wrong archive answers, chosen by sort, with nothing failing.
 */
describe('the Chrome job names the Chrome archive', () => {
  it('downloads and packs *-chrome.zip, never the bare glob', () => {
    expect(cwsSubmit).not.toContain('.output/*.zip');
    expect(cwsSubmit).not.toContain("--pattern '*.zip'");
    expect(cwsSubmit.match(/\*-chrome\.zip/g)).toHaveLength(2);
  });
});

describe('the Firefox job', () => {
  /**
   * The id the script submits under is the id the Firefox build carries. Two
   * literals in two files; this is the one place they are compared, and a
   * submission under the wrong id is a 404 from AMO after the tag exists.
   */
  it('submits the gecko id the Firefox build carries', () => {
    const manifest = JSON.parse(readBuildFile('firefox', 'manifest.json'));
    expect(GECKO_ID).toBe(manifest.browser_specific_settings.gecko.id);
  });

  it('takes both Firefox archives from the release and attaches the xpi only on unlisted', () => {
    expect(amoSubmit).toContain("--pattern '*-firefox.zip' --pattern '*-sources.zip'");
    expect(amoSubmit).toContain("if: env.FIREFOX_CHANNEL == 'unlisted'");
    expect(amoSubmit).toContain('gh release upload "$TAG" .output/*.xpi --clobber');
  });

  /**
   * `wxt submit init` writes the API key and secret into `.env.submit`, and
   * the unlisted path writes a signed package beside the zips. Neither should
   * be what `git add -A` discovers.
   */
  it('has its secrets file and its signed package ignored', () => {
    expect(gitignore).toMatch(/^\.env\.submit$/m);
    expect(gitignore).toMatch(/^\*\.xpi$/m);
  });
});
