import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  AMO_ORIGIN,
  DOWNLOAD_ORIGINS,
  downloadHop,
  trustedAmoUrl,
  submitEnvironment,
  archiveNames,
  base64url,
  CHANNELS,
  claimSet,
  endpoints,
  GECKO_ID,
  issuerLooksValid,
  manifestMatches,
  MAX_JWT_LIFETIME_SECONDS,
  parseHash,
  readSignedFile,
  signingInput,
} from '@/scripts/lib/amo.mjs';

/**
 * The Firefox Add-ons submission, tested where it can be wrong silently.
 *
 * `wxt submit` does the upload; what this repository adds is the archive check
 * before it and the signed-file fetch after it (unlisted only), and both are
 * decisions about what a response or a manifest *means*. Same shape as
 * `cws.test.ts`: literal strings, not the helpers rebuilt, so a typo has to be
 * made twice to pass.
 */

describe('constants', () => {
  it('names the id the Firefox manifest carries, and both channels', () => {
    expect(GECKO_ID).toBe('headerlab@say8425.github.io');
    expect(CHANNELS).toEqual(['listed', 'unlisted']);
    expect(AMO_ORIGIN).toBe('https://addons.mozilla.org');
    // "must be no longer than five minutes past the issued at time".
    expect(MAX_JWT_LIFETIME_SECONDS).toBe(300);
  });
});

describe('archiveNames', () => {
  it('names the three files a version produces, exactly as wxt zip and the fetch write them', () => {
    expect(archiveNames('1.8.0')).toEqual({
      extension: 'headerlab-1.8.0-firefox.zip',
      sources: 'headerlab-1.8.0-sources.zip',
      signed: 'headerlab-1.8.0-firefox.xpi',
    });
  });

  it('refuses anything that is not a three-part version', () => {
    expect(() => archiveNames('')).toThrow(/version/);
    expect(() => archiveNames('v1.8.0')).toThrow(/version/);
    expect(() => archiveNames('1.8')).toThrow(/version/);
  });
});

describe('issuerLooksValid', () => {
  it('accepts the user:<id>:<key> shape AMO issues and nothing else', () => {
    expect(issuerLooksValid('user:12345678:123')).toBe(true);
    expect(issuerLooksValid('user:1:1')).toBe(true);
    expect(issuerLooksValid('')).toBe(false);
    expect(issuerLooksValid('user:abc:1')).toBe(false);
    expect(issuerLooksValid('12345678:123')).toBe(false);
    expect(issuerLooksValid(undefined)).toBe(false);
  });
});

describe('claimSet', () => {
  const now = 1_760_000_000;

  it('builds the four claims AMO requires, sixty seconds long by default', () => {
    expect(claimSet({ issuer: 'user:12345678:123', now, jti: 'nonce-1' })).toEqual({
      iss: 'user:12345678:123',
      jti: 'nonce-1',
      iat: now,
      exp: now + 60,
    });
  });

  it('refuses a lifetime past the five-minute cap, and a zero one', () => {
    expect(() => claimSet({ issuer: 'user:1:1', now, jti: 'n', lifetimeSeconds: 301 })).toThrow(
      /300/,
    );
    expect(() => claimSet({ issuer: 'user:1:1', now, jti: 'n', lifetimeSeconds: 0 })).toThrow(
      /300/,
    );
    expect(claimSet({ issuer: 'user:1:1', now, jti: 'n', lifetimeSeconds: 300 }).exp).toBe(
      now + 300,
    );
  });

  it('refuses a malformed issuer, a missing nonce and a non-integer clock', () => {
    expect(() => claimSet({ issuer: 'nope', now, jti: 'n' })).toThrow(/issuer/);
    expect(() => claimSet({ issuer: 'user:1:1', now, jti: '' })).toThrow(/jti/);
    expect(() => claimSet({ issuer: 'user:1:1', now: 1.5, jti: 'n' })).toThrow(/now/);
  });
});

describe('signingInput', () => {
  it('encodes a fixed HS256 header and the claims, base64url without padding', () => {
    const claims = { iss: 'user:1:1', jti: 'n', iat: 1, exp: 61 };
    const input = signingInput(claims);
    const [header, payload, ...rest] = input.split('.');
    expect(rest).toEqual([]);
    expect(Buffer.from(header!, 'base64url').toString()).toBe('{"alg":"HS256","typ":"JWT"}');
    expect(JSON.parse(Buffer.from(payload!, 'base64url').toString())).toEqual(claims);
    expect(input).not.toMatch(/[=+/]/);
  });

  it("base64url matches Node's own encoding", () => {
    expect(base64url('ÿþ?')).toBe(Buffer.from('ÿþ?').toString('base64url'));
  });
});

describe('endpoints', () => {
  it('builds the add-on, version list and version detail URLs from the raw id', () => {
    const api = endpoints('headerlab@say8425.github.io');
    expect(api.addon).toBe(
      'https://addons.mozilla.org/api/v5/addons/addon/headerlab@say8425.github.io/',
    );
    expect(api.versions()).toBe(
      'https://addons.mozilla.org/api/v5/addons/addon/headerlab@say8425.github.io/versions/',
    );
    expect(api.versions('all_with_unlisted')).toBe(
      'https://addons.mozilla.org/api/v5/addons/addon/headerlab@say8425.github.io/versions/?filter=all_with_unlisted',
    );
    expect(api.version('1.8.0')).toBe(
      'https://addons.mozilla.org/api/v5/addons/addon/headerlab@say8425.github.io/versions/1.8.0/',
    );
  });

  it('refuses to build a URL with a hole in it', () => {
    expect(() => endpoints('')).toThrow(/id/);
  });
});

describe('parseHash', () => {
  it("splits AMO's sha256:<hex> form", () => {
    expect(parseHash('sha256:' + 'AB'.repeat(32))).toEqual({
      algorithm: 'sha256',
      hex: 'ab'.repeat(32),
    });
  });

  it('refuses another algorithm and a bare hex, loudly', () => {
    expect(() => parseHash('sha512:abc')).toThrow(/sha256/);
    expect(() => parseHash('abcdef')).toThrow(/hash/);
    expect(() => parseHash('')).toThrow(/hash/);
  });
});

/**
 * The judgment table. The API documents exactly three file states — `public`,
 * `unreviewed`, `disabled` — and this refuses a fourth rather than guessing,
 * the same fail-closed shape as `UPLOADABLE_STATES` in cws.mjs.
 */
describe('readSignedFile', () => {
  const version = (over: Record<string, unknown> = {}) => ({
    version: '1.8.0',
    channel: 'unlisted',
    file: {
      status: 'public',
      url: 'https://addons.mozilla.org/firefox/downloads/file/1/x.xpi',
      hash: 'sha256:ab',
    },
    ...over,
  });

  it('is ready when the file is public and carries a url and a hash', () => {
    expect(readSignedFile(version(), { channel: 'unlisted' })).toEqual({
      kind: 'ready',
      url: 'https://addons.mozilla.org/firefox/downloads/file/1/x.xpi',
      hash: 'sha256:ab',
    });
  });

  it('waits while the file is unreviewed', () => {
    const v = version({ file: { status: 'unreviewed', url: '', hash: '' } });
    expect(readSignedFile(v, { channel: 'unlisted' })).toEqual({
      kind: 'wait',
      status: 'unreviewed',
    });
  });

  it('refuses a disabled file, naming what disabled means', () => {
    const v = version({ file: { status: 'disabled', url: '', hash: '' } });
    expect(readSignedFile(v, { channel: 'unlisted' })).toEqual({
      kind: 'refused',
      reason: 'the file is disabled: rejected, disabled, or not reviewed',
    });
  });

  it('refuses a version on the other channel', () => {
    const verdict = readSignedFile(version({ channel: 'listed' }), { channel: 'unlisted' });
    expect(verdict.kind).toBe('refused');
    expect(verdict).toMatchObject({ reason: expect.stringContaining('listed') });
  });

  it('refuses a status the API does not document, rather than reading it as anything', () => {
    const v = version({ file: { status: 'approved', url: 'x', hash: 'y' } });
    expect(readSignedFile(v, { channel: 'unlisted' })).toEqual({
      kind: 'refused',
      reason:
        'unrecognised file status "approved" — the API documents public, unreviewed and disabled',
    });
  });

  it('refuses a public file with no url or no hash, and a version with no file', () => {
    expect(
      readSignedFile(version({ file: { status: 'public', url: '', hash: 'sha256:ab' } }), {
        channel: 'unlisted',
      }),
    ).toMatchObject({ kind: 'refused', reason: expect.stringContaining('url') });
    expect(
      readSignedFile(version({ file: { status: 'public', url: 'u', hash: '' } }), {
        channel: 'unlisted',
      }),
    ).toMatchObject({ kind: 'refused', reason: expect.stringContaining('hash') });
    expect(readSignedFile(version({ file: undefined }), { channel: 'unlisted' })).toMatchObject({
      kind: 'refused',
      reason: expect.stringContaining('file'),
    });
    expect(readSignedFile(null, { channel: 'unlisted' })).toMatchObject({ kind: 'refused' });
  });
});

describe('manifestMatches', () => {
  const manifest = {
    version: '1.8.0',
    browser_specific_settings: { gecko: { id: 'headerlab@say8425.github.io' } },
  };

  it('is empty when the archive holds the version and the id being submitted', () => {
    expect(manifestMatches(manifest, { version: '1.8.0', geckoId: GECKO_ID })).toEqual([]);
  });

  it('names each mismatch, and both at once', () => {
    expect(manifestMatches(manifest, { version: '1.9.0', geckoId: GECKO_ID })).toEqual([
      'manifest version is "1.8.0", expected 1.9.0',
    ]);
    expect(manifestMatches({ version: '1.8.0' }, { version: '1.8.0', geckoId: GECKO_ID })).toEqual([
      'gecko id is undefined, expected headerlab@say8425.github.io',
    ]);
    expect(manifestMatches({}, { version: '1.8.0', geckoId: GECKO_ID })).toHaveLength(2);
  });
});

describe('request security', () => {
  it('rejects external, insecure and credential-bearing URLs before sending a JWT', () => {
    for (const url of [
      'https://evil.example/a.xpi',
      'http://addons.mozilla.org/a',
      'https://addons.mozilla.org.evil.example/a',
      'https://user:pass@addons.mozilla.org/a',
      'https://addons.mozilla.org:444/a',
    ]) {
      expect(() => trustedAmoUrl(url)).toThrow(/trusted AMO origin/);
    }
    expect(trustedAmoUrl('https://addons.mozilla.org/a.xpi')).toBe(
      'https://addons.mozilla.org/a.xpi',
    );
  });
  it('requires a complete sha256 digest', () => {
    expect(() => parseHash('sha256:ab')).toThrow(/64/);
  });
  it('removes ambient store settings and forces review submission', () => {
    expect(
      submitEnvironment(
        {
          PATH: '/bin',
          CHROME_ZIP: 'chrome.zip',
          EDGE_ZIP: 'edge.zip',
          OPERA_ZIP: 'opera.zip',
          FIREFOX_COMPATIBILITY: 'android',
          FIREFOX_SKIP_SUBMIT_REVIEW: 'true',
          DRY_RUN: 'true',
        },
        { issuer: 'user:1:1', secret: 'secret' },
        { binDir: '/repo/node_modules/.bin' },
      ),
    ).toEqual({
      PATH: '/repo/node_modules/.bin:/bin',
      FIREFOX_EXTENSION_ID: GECKO_ID,
      FIREFOX_JWT_ISSUER: 'user:1:1',
      FIREFOX_JWT_SECRET: 'secret',
      DRY_RUN: 'false',
      FIREFOX_SKIP_SUBMIT_REVIEW: 'false',
    });
  });
});

/**
 * `wxt submit` is an alias that spawns `wxt-publish-extension` by bare name, and
 * only `pnpm run` puts node_modules/.bin on PATH. Run the way the workflow runs
 * it — `node scripts/amo-submit.mjs` — the alias could not find the binary and
 * exited 1 with zero bytes of output (reproduced 2026-09-11 with a runner-like
 * PATH). These pin the fix where it lives.
 */
describe("the submit child's PATH", () => {
  const creds = { issuer: 'user:1:1', secret: 's' };

  it('puts node_modules/.bin first and keeps the rest', () => {
    const env = submitEnvironment({ PATH: '/usr/bin:/bin' }, creds, {
      binDir: '/repo/node_modules/.bin',
    });
    expect(env.PATH).toBe('/repo/node_modules/.bin:/usr/bin:/bin');
  });

  it('still names the bin directory when the parent had no PATH', () => {
    expect(submitEnvironment({}, creds, { binDir: '/b' }).PATH).toBe('/b');
  });

  it('refuses to build an environment without one', () => {
    expect(() => submitEnvironment({}, creds, {} as never)).toThrow(/binDir/);
  });
});

/**
 * The signed-file download follows redirects by hand, so where the JWT goes is
 * decided in one place. These pin both halves: the two origins it may reach,
 * and that the credential reaches only the first.
 */
describe('downloadHop', () => {
  it('allows AMO and its CDN, and nothing else', () => {
    expect(DOWNLOAD_ORIGINS).toEqual([
      'https://addons.mozilla.org',
      'https://addons.cdn.mozilla.net',
    ]);
  });

  it('follows a redirect on AMO with the JWT, and to the CDN without it', () => {
    expect(
      downloadHop('/firefox/downloads/file/1/x.xpi', 'https://addons.mozilla.org/api/v5/x'),
    ).toEqual({
      url: 'https://addons.mozilla.org/firefox/downloads/file/1/x.xpi',
      withAuth: true,
    });
    expect(
      downloadHop(
        'https://addons.cdn.mozilla.net/user-media/addons/1/x.xpi',
        'https://addons.mozilla.org/firefox/downloads/file/1/x.xpi',
      ),
    ).toEqual({ url: 'https://addons.cdn.mozilla.net/user-media/addons/1/x.xpi', withAuth: false });
  });

  it.each([
    'https://evil.example/x.xpi',
    '//evil.example/x.xpi',
    'http://addons.cdn.mozilla.net/x.xpi',
    'https://addons.cdn.mozilla.net.evil.example/x.xpi',
    'https://u:p@addons.mozilla.org/x.xpi',
    'https://addons.mozilla.org:444/x.xpi',
  ])('refuses a redirect to %s', (location) => {
    expect(() => downloadHop(location, 'https://addons.mozilla.org/a')).toThrow(/refusing/);
  });
});

describe('CLI preflight', () => {
  it.each([
    ['--channel', 'invalid'],
    ['--timeout-minutes', 'Infinity'],
    ['--timeout-minutes', '0'],
    ['--expect-version', '../../other'],
  ])('refuses %s %s before credentials or network', (flag, value) => {
    const result = spawnSync(process.execPath, ['scripts/amo-submit.mjs', flag, value], {
      encoding: 'utf8',
      env: { PATH: '', CI: 'true' },
    });
    expect(result.status).toBe(1);
    // Case-insensitive: the refusal reads "set both …", and a case-sensitive
    // pattern would leave only the 1Password alternative doing any work.
    expect(result.stderr).not.toMatch(/1Password|set both FIREFOX/i);
    expect(result.stderr).toMatch(/channel|timeout|version/);
  });
  it('prints help without reading a credential', () => {
    const result = spawnSync(process.execPath, ['scripts/amo-submit.mjs', '--help'], {
      encoding: 'utf8',
      env: { PATH: '', CI: 'true' },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('usage:');
  });
});
