# Firefox Add-ons (AMO) Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 릴리스 PR 머지가 Firefox 빌드를 AMO 에도 제출하게 하고 (listed 기본, unlisted 면 서명된 xpi 를 릴리스에 첨부), 그 리스팅을 사람이 처음 한 번 만들 수 있게 문서·문안을 갖추며, 개인정보 정책과 README 가 두 브라우저를 말하게 한다.

**Architecture:** Chrome Web Store 경로의 거울이다. `pnpm zip` 이 세 아카이브를 만들고 릴리스 잡이 셋을 붙인다; 릴리스 잡은 `cws-submit.yml`(개명) 과 새 `amo-submit.yml` 을 나란히 부르고, 후자는 `firefox-amo` 환경의 시크릿만 읽어 `scripts/amo-submit.mjs` 를 돌린다 — 그 스크립트가 로컬(1Password)과 CI(env)의 하나뿐인 진입점이고, 아카이브 검사 → `wxt submit` → (unlisted) 서명 xpi 수신을 한다. 판정은 `scripts/lib/amo.mjs` 에 순수하게, I/O 는 진입점에.

**Tech Stack:** `wxt submit` = `publish-browser-extension@5.1.0` (wxt 의 의존성, 새 설치 없음), Node 24 내장(`node:crypto` HMAC, `util.parseArgs`, `fetch`), `unzip`, `gh`, `op`. GitHub Actions 재사용 워크플로 + 환경 시크릿.

**Spec:** `docs/superpowers/specs/2026-09-10-amo-distribution-design.md`. 이 플랜이 스펙과 다르면 스펙이 맞다. 스펙의 §2 는 실측이고 §12 는 결정 기록이다.

## Global Constraints

- **새 의존성 없음.** `package.json` 의 `dependencies`/`devDependencies` 와 `pnpm-lock.yaml` 은 한 바이트도 바뀌지 않는다. `wxt submit` 은 이미 있는 것이다.
- **pnpm 만 쓴다.** `pnpm test` 는 빌드를 포함한다 — 빌드 산출물을 읽는 테스트를 bare `vitest run` 으로 돌리지 않는다.
- **시크릿은 절대 출력하지 않는다.** `op read` 의 출력은 프로세스 env 나 파이프로만 흐른다. 로그·리포트·커밋에 issuer 나 secret 값을 쓰지 않는다 (issuer 도 시크릿으로 취급). `.env.submit` 은 만들지 않는다.
- **환경 이름은 정확히 `firefox-amo`**, Chrome 은 `chrome-web-store`. 시크릿 이름은 `FIREFOX_JWT_ISSUER`, `FIREFOX_JWT_SECRET`; 변수 `FIREFOX_CHANNEL`. gecko id 는 `headerlab@say8425.github.io`.
- **채널 기본은 `listed`.** dispatch 입력 > 환경 변수 > `listed`.
- **Chrome 단계는 `*-chrome.zip` 을 명시한다.** `.output/*.zip` glob 은 `cws-submit.yml` 에 남지 않는다.
- **YAML 은 블록 스타일.** `tests/unit/storeSubmit.test.ts` 가 6칸 들여쓰기의 `tag:`/`version:` 을 센다.
- **워크플로의 액션 참조는 플로팅 메이저** (`@v7`), 로컬 액션·재사용 워크플로는 `./` 경로.
- **문안 규칙:** AMO 문안은 `docs/store/description.en.md` 와 줄 단위 차이만 두고, Markdown 문자 없이 평문. `Chrome-only` 라는 낱말이 브릿지 문단에 있어야 한다.
- **린트는 `correctness` 를 error 로 돈다.** 쓰지 않는 변수·import 는 빌드를 깨뜨린다. `pnpm format` 으로 `.mjs`/`.ts` 를 정리한다 (`docs/**`, `*.md` 는 oxfmt 가 보지 않는다).
- **커밋:** `<type>: <description>`, 영어. 모든 커밋 메시지는 다음 두 트레일러로 끝난다:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01X7XpCj1bESKpE1VkojMAis
  ```
- 브랜치는 `feat/amo-distribution` (이미 있음, 스펙 커밋 `c827b70` 위). 푸시와 PR 은 컨트롤러가 한다 — 과제 안에서 `git push` 하지 않는다.

---

## 파일 구조

**새로 만드는 것**

| 파일 | 책임 |
| --- | --- |
| `scripts/lib/amo.mjs` (+ `amo.d.mts`) | 순수: 아카이브 이름, JWT 클레임, 엔드포인트, `file.status` 판정, manifest 대조 |
| `tests/unit/amo.test.ts` | 위 모듈의 판정표 전부 |
| `scripts/amo-submit.mjs` | 로컬·CI 진입점: 자격 증명(env→1Password) → 아카이브 검사 → `wxt submit` → unlisted 면 서명 xpi 수신 |
| `scripts/amo-probe.mjs` | 읽기 전용 상태 조회 |
| `.github/workflows/amo-submit.yml` | 재사용 워크플로, `firefox-amo` 환경 |
| `docs/store/amo/{README,checklist,listing,description.en,reviewer-notes}.md` | AMO 리스팅 런북과 문안 |

**고치는 것**

| 파일 | 무엇 |
| --- | --- |
| `package.json` | `zip` 세 아카이브, `amo:submit`, `amo:probe` |
| `wxt.config.ts` | `zip.excludeSources: ['docs/**']` |
| `.gitignore` | `.env.submit`, `*.xpi` |
| `.github/workflows/store-submit.yml` → `cws-submit.yml` | 개명, `*-chrome.zip` 두 곳, `name:` |
| `.github/workflows/release-please.yml` | 세 아카이브 주석, `cws-submit`·`amo-submit` 잡 |
| `scripts/pack-crx.mjs`, `docs/store/checklist.md` | 개명된 파일명 |
| `tests/unit/storeSubmit.test.ts` | 두 워크플로 가드 |
| `tests/unit/storeListing.test.ts` | AMO 문안 가드 |
| `docs/store/README.md` | `amo/` 행 |
| `PRIVACY.md` | 브라우저 중립 재작성 |
| `README.md`, `docs/README.{ko,ja,zh,es}.md` | Install 네 곳, Development 두 줄 |
| `CLAUDE.md` | Commands, Release, 새 AMO 절, Chrome Web Store 한 문장, Known gaps |

---

### Task 1: `scripts/lib/amo.mjs` — 판정을 먼저, 순수하게

**Files:**
- Create: `scripts/lib/amo.mjs`, `scripts/lib/amo.d.mts`
- Test: `tests/unit/amo.test.ts`

**Interfaces:**
- Produces (Task 2·3·4 가 쓴다):
  - `AMO_ORIGIN: 'https://addons.mozilla.org'`, `GECKO_ID: 'headerlab@say8425.github.io'`, `CHANNELS: ['listed', 'unlisted']`, `MAX_JWT_LIFETIME_SECONDS: 300`
  - `base64url(input: string | Uint8Array): string`
  - `archiveNames(version: string): { extension: string; sources: string; signed: string }`
  - `issuerLooksValid(issuer: unknown): boolean`
  - `claimSet({ issuer, now, jti, lifetimeSeconds? }): { iss; jti; iat; exp }`
  - `signingInput(claims: object): string` — `base64url(header).base64url(claims)`
  - `endpoints(id: string): { addon: string; versions(filter?: string): string; version(number: string): string }`
  - `parseHash(hash: string): { algorithm: 'sha256'; hex: string }`
  - `readSignedFile(version: unknown, { channel }): { kind: 'ready'; url; hash } | { kind: 'wait'; status } | { kind: 'refused'; reason }`
  - `manifestMatches(manifest: unknown, { version, geckoId }): string[]` — 빈 배열이면 일치

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/amo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  AMO_ORIGIN,
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
    expect(() => claimSet({ issuer: 'user:1:1', now, jti: 'n', lifetimeSeconds: 0 })).toThrow(/300/);
    expect(claimSet({ issuer: 'user:1:1', now, jti: 'n', lifetimeSeconds: 300 }).exp).toBe(now + 300);
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

  it('base64url matches Node\'s own encoding', () => {
    expect(base64url('ÿþ?')).toBe(Buffer.from('ÿþ?').toString('base64url'));
  });
});

describe('endpoints', () => {
  it('builds the add-on, version list and version detail URLs from the raw id', () => {
    const api = endpoints('headerlab@say8425.github.io');
    expect(api.addon).toBe('https://addons.mozilla.org/api/v5/addons/addon/headerlab@say8425.github.io/');
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
  it('splits AMO\'s sha256:<hex> form', () => {
    expect(parseHash('sha256:ABCDEF0123')).toEqual({ algorithm: 'sha256', hex: 'abcdef0123' });
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
    file: { status: 'public', url: 'https://addons.mozilla.org/firefox/downloads/file/1/x.xpi', hash: 'sha256:ab' },
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
    expect(readSignedFile(v, { channel: 'unlisted' })).toEqual({ kind: 'wait', status: 'unreviewed' });
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
      reason: 'unrecognised file status "approved" — the API documents public, unreviewed and disabled',
    });
  });

  it('refuses a public file with no url or no hash, and a version with no file', () => {
    expect(readSignedFile(version({ file: { status: 'public', url: '', hash: 'sha256:ab' } }), { channel: 'unlisted' }))
      .toMatchObject({ kind: 'refused', reason: expect.stringContaining('url') });
    expect(readSignedFile(version({ file: { status: 'public', url: 'u', hash: '' } }), { channel: 'unlisted' }))
      .toMatchObject({ kind: 'refused', reason: expect.stringContaining('hash') });
    expect(readSignedFile(version({ file: undefined }), { channel: 'unlisted' }))
      .toMatchObject({ kind: 'refused', reason: expect.stringContaining('file') });
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
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm exec vitest run tests/unit/amo.test.ts`
Expected: FAIL — `Failed to resolve import "@/scripts/lib/amo.mjs"`. (이 파일은 빌드 산출물을 읽지 않으므로 bare 실행이 허용되는 드문 경우다.)

- [ ] **Step 3: 구현한다**

`scripts/lib/amo.mjs`:

```js
/**
 * Firefox Add-ons (AMO) — the decisions, without the requests.
 *
 * Everything here is pure: names, endpoints, a JWT claim set, and readers that
 * turn an AMO response or an archive's manifest into a verdict.
 * `scripts/amo-submit.mjs` and `scripts/amo-probe.mjs` do the I/O. Same split
 * as `scripts/lib/cws.mjs` beside it, and for the same reason — the parts that
 * can be wrong in a way nobody notices are the parts that decide what a
 * response *means*, and those are the parts a test can reach without a
 * network, a key, or a listing.
 *
 * `wxt submit` (publish-browser-extension 5.1.0, a dependency of wxt) does the
 * upload itself: get the add-on, upload the zip, poll validation, create the
 * version with the sources archive attached. What it does not do, and what this
 * module decides for, is (1) whether the archive on disk is the version being
 * submitted — `pack-crx.mjs` makes the same check for the same reason — and
 * (2) whether an unlisted version's file is signed yet and safe to download.
 *
 * **The JWT.** AMO authenticates API calls with `Authorization: JWT <token>`:
 * HS256 over `{ iss, jti, iat, exp }`, where `iss` is the API key, `jti` a
 * nonce, and `exp` "must be no longer than five minutes past the issued at
 * time" (addons-server, topics/api/auth). The claim set is assembled here so a
 * test can pin it; `node:crypto` signs it in the caller.
 */

export const AMO_ORIGIN = 'https://addons.mozilla.org';

/** The gecko id. Public — it is in the manifest and in the README. */
export const GECKO_ID = 'headerlab@say8425.github.io';

/** The two channels an upload can name. `enterprise` exists and is not ours. */
export const CHANNELS = ['listed', 'unlisted'];

/** AMO's own cap on a token's life. A longer one is refused with a bare 401. */
export const MAX_JWT_LIFETIME_SECONDS = 300;

/** Base64url, no padding — what JWS wants. Node's own encoding, named. */
export const base64url = (input) => Buffer.from(input).toString('base64url');

/**
 * The three files a version produces. The first two are what `wxt zip -b
 * firefox` writes (its `artifactTemplate` and `sourcesTemplate` defaults); the
 * third is what the unlisted path writes after AMO signs.
 */
export const archiveNames = (version) => {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
    throw new Error(`archiveNames: not a three-part version: ${JSON.stringify(version)}`);
  }
  return {
    extension: `headerlab-${version}-firefox.zip`,
    sources: `headerlab-${version}-sources.zip`,
    signed: `headerlab-${version}-firefox.xpi`,
  };
};

/**
 * AMO's API keys read `user:<user id>:<key id>`. The workflow refuses to start
 * on anything else, because an absent secret arrives as `""` and would
 * otherwise reach `wxt submit` after the checkout and the install.
 */
export const issuerLooksValid = (issuer) => /^user:\d+:\d+$/.test(issuer ?? '');

export const claimSet = ({ issuer, now, jti, lifetimeSeconds = 60 }) => {
  if (!issuerLooksValid(issuer)) {
    throw new Error('claimSet: issuer does not look like an AMO API key (user:<id>:<key>)');
  }
  if (!jti) throw new Error('claimSet: jti (a nonce) is required');
  if (!Number.isInteger(now)) throw new Error('claimSet: now must be an integer epoch second');
  if (!(lifetimeSeconds > 0 && lifetimeSeconds <= MAX_JWT_LIFETIME_SECONDS)) {
    throw new Error(
      `claimSet: lifetime must be between 1 and ${MAX_JWT_LIFETIME_SECONDS} seconds, got ${lifetimeSeconds}`,
    );
  }
  return { iss: issuer, jti, iat: now, exp: now + lifetimeSeconds };
};

/** `header.payload`, which is the whole of what HMAC signs. */
export const signingInput = (claims) =>
  `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}`;

/**
 * The three endpoints this repository reads. The id goes into the path raw —
 * `@` included — which is how publish-browser-extension addresses the same
 * endpoints and what the API accepts.
 */
export const endpoints = (id) => {
  if (!id) throw new Error('endpoints: id is required');
  const addon = `${AMO_ORIGIN}/api/v5/addons/addon/${id}/`;
  return {
    addon,
    versions: (filter) => `${addon}versions/${filter ? `?filter=${filter}` : ''}`,
    version: (number) => `${addon}versions/${number}/`,
  };
};

/** `file.hash` is `sha256:<hex>`. Anything else is a schema drift, not a hash. */
export const parseHash = (hash) => {
  const match = /^([a-z0-9]+):([0-9a-f]+)$/i.exec(hash ?? '');
  if (!match) throw new Error(`parseHash: not an <algorithm>:<hex> hash: ${JSON.stringify(hash)}`);
  const [, algorithm, hex] = match;
  if (algorithm.toLowerCase() !== 'sha256') {
    throw new Error(`parseHash: expected sha256, got ${algorithm}`);
  }
  return { algorithm: 'sha256', hex: hex.toLowerCase() };
};

/**
 * What a version-detail response means for the unlisted path.
 *
 * The API documents three file states — `public` (Approved), `unreviewed`
 * (Awaiting Review), `disabled` (Rejected, disabled, or not reviewed) — and this
 * refuses a fourth rather than reading it as either. Fail-closed, like
 * `UPLOADABLE_STATES` in cws.mjs: an unrecognised value is a schema drift, and
 * the one place it must not be silently absorbed is the loop that decides
 * whether to keep waiting.
 */
export const readSignedFile = (version, { channel }) => {
  if (!version || typeof version !== 'object') {
    return { kind: 'refused', reason: 'no version object in the response' };
  }
  if (version.channel !== channel) {
    return {
      kind: 'refused',
      reason: `version ${version.version ?? '?'} is on the ${version.channel ?? 'unknown'} channel, not ${channel}`,
    };
  }
  const file = version.file;
  if (!file || typeof file !== 'object') {
    return { kind: 'refused', reason: 'the version carries no file object' };
  }
  const status = file.status;
  if (status === 'public') {
    if (typeof file.url !== 'string' || file.url === '') {
      return { kind: 'refused', reason: 'the file is public but carries no url' };
    }
    if (typeof file.hash !== 'string' || file.hash === '') {
      return { kind: 'refused', reason: 'the file is public but carries no hash' };
    }
    return { kind: 'ready', url: file.url, hash: file.hash };
  }
  if (status === 'unreviewed') return { kind: 'wait', status };
  if (status === 'disabled') {
    return { kind: 'refused', reason: 'the file is disabled: rejected, disabled, or not reviewed' };
  }
  return {
    kind: 'refused',
    reason: `unrecognised file status ${JSON.stringify(status)} — the API documents public, unreviewed and disabled`,
  };
};

/**
 * Whether the archive on disk is the version being submitted.
 *
 * The archive is an argument (or a release download) and the version is an
 * input; taking the bytes from one and the name from the other is how a 1.8.0
 * package gets submitted as 1.9.0 with nothing failing. Empty means "matches".
 */
export const manifestMatches = (manifest, { version, geckoId }) => {
  const problems = [];
  const actualVersion = manifest?.version;
  if (actualVersion !== version) {
    problems.push(`manifest version is ${JSON.stringify(actualVersion)}, expected ${version}`);
  }
  const actualId = manifest?.browser_specific_settings?.gecko?.id;
  if (actualId !== geckoId) {
    problems.push(`gecko id is ${JSON.stringify(actualId)}, expected ${geckoId}`);
  }
  return problems;
};
```

`scripts/lib/amo.d.mts`:

```ts
/**
 * Hand-written declarations for `amo.mjs`, whose exports are consumed from
 * TypeScript by `tests/unit/amo.test.ts`. Without this file `tsc --noEmit`
 * fails that import with TS7016 — `allowJs` is off. Same gap `cws.d.mts`,
 * `crx.d.mts` and `png.d.mts` close for their own modules, and the same
 * caveat: nothing checks that this still matches the implementation
 * (CLAUDE.md, "Known gaps").
 */

export declare const AMO_ORIGIN: string;
export declare const GECKO_ID: string;
export declare const CHANNELS: readonly string[];
export declare const MAX_JWT_LIFETIME_SECONDS: number;

export declare function base64url(input: string | Uint8Array): string;

export declare function archiveNames(version: string): {
  extension: string;
  sources: string;
  signed: string;
};

export declare function issuerLooksValid(issuer: unknown): boolean;

export declare function claimSet(input: {
  issuer: string;
  now: number;
  jti: string;
  lifetimeSeconds?: number;
}): { iss: string; jti: string; iat: number; exp: number };

export declare function signingInput(claims: object): string;

export declare function endpoints(id: string): {
  addon: string;
  versions: (filter?: string) => string;
  version: (number: string) => string;
};

export declare function parseHash(hash: string): { algorithm: 'sha256'; hex: string };

export type SignedFileVerdict =
  | { kind: 'ready'; url: string; hash: string }
  | { kind: 'wait'; status: string }
  | { kind: 'refused'; reason: string };

export declare function readSignedFile(
  version: unknown,
  options: { channel: string },
): SignedFileVerdict;

export declare function manifestMatches(
  manifest: unknown,
  expected: { version: string; geckoId: string },
): string[];
```

- [ ] **Step 4: 통과를 확인하고 정리한다**

Run: `pnpm exec vitest run tests/unit/amo.test.ts && pnpm format && pnpm lint && pnpm typecheck`
Expected: 21 tests PASS, 포맷·린트·타입체크 깨끗.

- [ ] **Step 5: 변이 검증**

`scripts/lib/amo.mjs` 의 `if (status === 'unreviewed') return { kind: 'wait', status };` 바로 위에 `if (status === 'approved') return { kind: 'ready', url: file.url, hash: file.hash };` 를 **줄 번호로** 심고 (`sed -n` 으로 심은 줄을 다시 읽어 확인) `pnpm exec vitest run tests/unit/amo.test.ts` → "refuses a status the API does not document" FAIL 확인 → 되돌린다 (`git checkout -- scripts/lib/amo.mjs` 는 **커밋 전이라 위험** — 심은 줄만 손으로 지우고 `git diff` 가 비어 있음을 확인).

- [ ] **Step 6: 커밋**

```bash
git add scripts/lib/amo.mjs scripts/lib/amo.d.mts tests/unit/amo.test.ts
git commit -F - <<'EOF'
feat: decide the AMO submission's verdicts in a pure module

Archive names, the JWT claim set AMO accepts (five-minute cap), the three
endpoints the scripts read, the file-status judgment table for an unlisted
version's signed file (fail-closed on a fourth state), and the check that
the archive on disk is the version being submitted.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X7XpCj1bESKpE1VkojMAis
EOF
```

---

### Task 2: 아카이브 셋, `amo-submit.mjs`, `amo-probe.mjs`

**Files:**
- Modify: `package.json` (scripts), `wxt.config.ts` (`zip`), `.gitignore`
- Create: `scripts/amo-submit.mjs`, `scripts/amo-probe.mjs`

**Interfaces:**
- Consumes: Task 1 의 `scripts/lib/amo.mjs` 전부.
- Produces (Task 3 의 워크플로가 친다): `node scripts/amo-submit.mjs --channel <listed|unlisted> --expect-version <v>` — env `FIREFOX_JWT_ISSUER`/`FIREFOX_JWT_SECRET` 이 있으면 그것을, 없으면 1Password 를 읽는다; `.output/headerlab-<v>-firefox.zip` 과 `-sources.zip` 이 있어야 하고, unlisted 면 `.output/headerlab-<v>-firefox.xpi` 를 쓴다. 종료 0/1. `pnpm zip` 이 `.output/` 에 `-chrome.zip`, `-firefox.zip`, `-sources.zip` 셋을 만든다.

- [ ] **Step 1: `package.json` 스크립트**

`"zip": "wxt zip"` 을 다음으로 바꾸고, `"crx"` 줄 앞에 두 줄을 더한다 (oxfmt 가 키를 정렬하므로 위치는 `pnpm format` 이 정한다):

```json
"zip": "wxt zip && wxt zip -b firefox",
"amo:submit": "wxt zip -b firefox && node scripts/amo-submit.mjs",
"amo:probe": "node scripts/amo-probe.mjs",
```

- [ ] **Step 2: `wxt.config.ts` — sources zip 에서 `docs/**` 제외**

`vite: () => ({` 바로 앞에 넣는다:

```ts
  zip: {
    // `wxt zip -b firefox` also writes `headerlab-<v>-sources.zip`, the archive
    // AMO's reviewers rebuild and diff against the package. WXT's defaults
    // already drop node_modules, the test files, `.output/` and every dotfile;
    // `docs/` is 67 more files (measured 2026-09-09), 1.2 MB of them store
    // PNGs, and none of them is a build input. `tests/` and `packages/` stay:
    // the former is twelve small files once the tests themselves are gone,
    // and the latter is named by pnpm-workspace.yaml, so a frozen install
    // without it is a prediction CLAUDE.md records getting wrong twice.
    // `.nvmrc` is a dotfile and is NOT in the archive — README's "Build it
    // yourself" states the Node version in words for that reason.
    excludeSources: ['docs/**'],
  },
```

- [ ] **Step 3: `.gitignore`**

파일 끝(`*.crx` 다음)에 더한다:

```gitignore

# `wxt submit init` writes the AMO API key and secret into this file, and the
# unlisted release path writes the signed Firefox package beside the zips.
# Neither should ever be what `git add -A` discovers. The credentials live in
# 1Password (`Firefox AMO Token`) and in the `firefox-amo` environment; see
# docs/store/amo/checklist.md.
.env.submit
*.xpi
```

- [ ] **Step 4: 세 아카이브를 만들고 sources zip 을 잰다**

```bash
find .output -maxdepth 1 -name '*.zip' -delete 2>/dev/null; pnpm zip && ls -l .output/*.zip
V=$(node -p "require('./package.json').version")
unzip -Z1 ".output/headerlab-$V-sources.zip" | wc -l
unzip -Z1 ".output/headerlab-$V-sources.zip" | grep -c '^docs/'
stat -f %z ".output/headerlab-$V-sources.zip"
```

Expected: `ls` 에 `-chrome.zip`, `-firefox.zip`, `-sources.zip` 셋. `grep -c '^docs/'` 는 **0**. 파일 수와 바이트 수를 리포트에 적는다 — Task 6 이 CLAUDE.md 에 옮긴다 (제외 전은 214 파일 · 2,767,184 B).

- [ ] **Step 5: `scripts/amo-submit.mjs`**

```js
/**
 * Submits the Firefox build to Firefox Add-ons (AMO), and on the unlisted
 * channel waits for the signed package and writes it beside the archives.
 *
 *   node scripts/amo-submit.mjs [--channel listed|unlisted] [--expect-version <v>]
 *                               [--dry-run] [--timeout-minutes <n>]
 *
 * `pnpm amo:submit` zips first. This is the one entry point for both the
 * developer's machine and `.github/workflows/amo-submit.yml` — the workflow
 * types exactly this command, the way `cws-submit.yml` types `pack-crx.mjs` —
 * so the archive check, the channel and the signed-file fetch exist once.
 *
 * What it does, in order:
 *   1. Finds `.output/headerlab-<v>-firefox.zip` and `-sources.zip` for the
 *      version being submitted (`--expect-version`, else package.json's).
 *   2. Reads the archive's manifest and refuses a version or gecko id that is
 *      not the one being submitted (`manifestMatches` — the same check
 *      `pack-crx.mjs` makes, for the same reason).
 *   3. Runs `wxt submit` — publish-browser-extension, a dependency of wxt —
 *      with the credentials in its environment. It gets the add-on, uploads
 *      the zip on the channel, polls validation (5s, ten minutes), and creates
 *      the version with the sources archive attached. `--dry-run` stops it
 *      after the first call: authentication and the add-on's existence.
 *   4. On `unlisted`, polls the version until AMO reports its file `public`,
 *      downloads it with the same JWT, checks the sha256 AMO published for it,
 *      and writes `headerlab-<v>-firefox.xpi`. On `listed` there is nothing to
 *      fetch: AMO hosts the file, and review is Mozilla's.
 *
 * Credentials: `FIREFOX_JWT_ISSUER` and `FIREFOX_JWT_SECRET` from the
 * environment (CI), else from 1Password — `op://Personal/Firefox AMO Token`,
 * fields `username` and `password`. Both flow only into the child's
 * environment and into an Authorization header, never into argv, a log line
 * or a file. The issuer is treated as a secret too.
 *
 * Exit codes: 0 done · 1 refused, or AMO refused. Nothing is retried here; the
 * workflow that calls it is re-runnable against an existing tag, and AMO
 * refuses a version it already holds, so a retry after a partial success
 * fails loudly rather than uploading twice.
 *
 * What is NOT here: creating the add-on. `wxt submit`'s first call is a GET
 * on it, so the first submission is by hand (docs/store/amo/checklist.md).
 *
 * **`file.url` sits outside `/api/` and whether the JWT header is honoured
 * there has not been measured** — `web-ext sign` downloads it that way, so
 * this does too, and the first unlisted run is the measurement.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  archiveNames,
  CHANNELS,
  claimSet,
  endpoints,
  GECKO_ID,
  issuerLooksValid,
  manifestMatches,
  parseHash,
  readSignedFile,
  signingInput,
} from './lib/amo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Where the API key lives when the environment does not carry it. */
const OP_ISSUER = 'op://Personal/Firefox AMO Token/username';
const OP_SECRET = 'op://Personal/Firefox AMO Token/password';

/**
 * `die` throws; it does not call `process.exit` — same reasons as
 * store-submit.mjs: control flow the analyser can see, and no truncated stdout
 * on a pipe, which is what Actions gives this script.
 */
class SubmitError extends Error {}
const die = (message) => {
  throw new SubmitError(message);
};
const log = (message) => console.log(`amo-submit: ${message}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `op read` writes to stdout and `execFileSync` hands it back — the value never
 * becomes a command argument, so it is not in `ps` output or shell history.
 */
const readOp = (reference) => {
  try {
    return execFileSync('op', ['read', reference], { maxBuffer: 1 << 20 }).toString().trim();
  } catch (error) {
    die(
      `could not read ${reference} from 1Password\n` +
        `  ${error.message.split('\n')[0]}\n` +
        '  Sign in with `op signin`, or set FIREFOX_JWT_ISSUER and FIREFOX_JWT_SECRET.',
    );
  }
};

const credentials = () => {
  const issuer = process.env.FIREFOX_JWT_ISSUER?.trim() || readOp(OP_ISSUER);
  const secret = process.env.FIREFOX_JWT_SECRET?.trim() || readOp(OP_SECRET);
  if (!issuerLooksValid(issuer)) {
    die('FIREFOX_JWT_ISSUER does not look like an AMO API key (user:<id>:<key>)');
  }
  if (!secret) die('FIREFOX_JWT_SECRET is empty');
  return { issuer, secret };
};

/** A fresh token per request: sixty seconds, a new nonce, HS256. */
const token = ({ issuer, secret }) => {
  const input = signingInput(
    claimSet({ issuer, now: Math.floor(Date.now() / 1000), jti: randomUUID() }),
  );
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
};

const locateArchives = (version) => {
  const names = archiveNames(version);
  const extension = path.join(ROOT, '.output', names.extension);
  const sources = path.join(ROOT, '.output', names.sources);
  for (const file of [extension, sources]) {
    if (!existsSync(file)) {
      die(
        `no archive at ${file}\n` +
          '  Build both with `pnpm zip`, or take them from the release:\n' +
          `  gh release download extension-v${version} -p '*-firefox.zip' -p '*-sources.zip' -D .output`,
      );
    }
  }
  return { extension, sources, signed: path.join(ROOT, '.output', names.signed) };
};

/**
 * The version comes out of the archive, not out of package.json or argv. The
 * archive is an argument (or a release download), and taking the bytes from
 * one place and the name from another is how a 1.8.0 package gets submitted
 * as 1.9.0 with nothing failing.
 */
const checkManifest = (zip, version) => {
  let manifest;
  try {
    manifest = JSON.parse(
      execFileSync('unzip', ['-p', zip, 'manifest.json'], { maxBuffer: 1 << 20 }).toString(),
    );
  } catch (error) {
    die(`cannot read manifest.json out of ${path.basename(zip)}: ${error.message.split('\n')[0]}`);
  }
  const problems = manifestMatches(manifest, { version, geckoId: GECKO_ID });
  if (problems.length > 0) {
    die(
      `${path.basename(zip)} is not the package being submitted:\n  ${problems.join('\n  ')}\n` +
        '  Check out the tag that archive belongs to, or pass --expect-version for it.',
    );
  }
};

/**
 * `node_modules/.bin/wxt` rather than `pnpm exec`: the same line works on this
 * machine and in the workflow, and does not depend on which pnpm is on PATH.
 * The credentials go in through the environment, which is where
 * publish-browser-extension reads them (`FIREFOX_JWT_*`, `FIREFOX_EXTENSION_ID`);
 * a `--firefox-*` flag wins over an environment variable there, so the channel
 * is passed as a flag and cannot be overridden by a stray `FIREFOX_CHANNEL`.
 */
const runWxtSubmit = ({ extension, sources, channel, dryRun, creds }) => {
  const wxt = path.join(ROOT, 'node_modules', '.bin', 'wxt');
  if (!existsSync(wxt)) die(`no wxt at ${wxt}\n  Run pnpm install first.`);
  const argv = [
    'submit',
    '--firefox-zip',
    extension,
    '--firefox-sources-zip',
    sources,
    '--firefox-channel',
    channel,
    ...(dryRun ? ['--dry-run'] : []),
  ];
  log(`wxt ${argv.join(' ')}`);
  const result = spawnSync(wxt, argv, {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      FIREFOX_EXTENSION_ID: GECKO_ID,
      FIREFOX_JWT_ISSUER: creds.issuer,
      FIREFOX_JWT_SECRET: creds.secret,
    },
  });
  if (result.error) die(`could not start wxt submit: ${result.error.message}`);
  if (result.status !== 0) {
    die(`wxt submit exited ${result.status}. Its output is above; nothing was retried.`);
  }
};

/**
 * Waits for AMO to sign the unlisted version, then takes the file.
 *
 * A 404 right after the version was created is read as "not visible yet"
 * rather than as an error; anything else non-2xx is. The loop stops on the
 * first `refused` — a disabled file, the wrong channel, a status the API does
 * not document — because none of those get better by waiting.
 */
const fetchSigned = async ({ version, channel, signed, creds, timeoutMinutes }) => {
  const api = endpoints(GECKO_ID);
  const deadline = Date.now() + timeoutMinutes * 60_000;
  const intervalMs = 15_000;
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(api.version(version), {
      headers: { Authorization: `JWT ${token(creds)}` },
    });
    const body = await response.json().catch(() => ({}));
    let verdict;
    if (response.status === 404) {
      verdict = { kind: 'wait', status: 'HTTP 404 (the version is not visible yet)' };
    } else if (!response.ok) {
      die(`GET version ${version} → HTTP ${response.status}\n${JSON.stringify(body, null, 2)}`);
    } else {
      verdict = readSignedFile(body, { channel });
    }
    if (verdict.kind === 'refused') die(`AMO will not hand over a signed file: ${verdict.reason}`);
    if (verdict.kind === 'ready') {
      const expected = parseHash(verdict.hash);
      const download = await fetch(verdict.url, {
        headers: { Authorization: `JWT ${token(creds)}` },
      });
      if (!download.ok) die(`GET ${verdict.url} → HTTP ${download.status}`);
      const bytes = Buffer.from(await download.arrayBuffer());
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== expected.hex) {
        die(`the downloaded file hashes to sha256:${actual}; AMO says ${verdict.hash}`);
      }
      writeFileSync(signed, bytes);
      log(`signed package written: ${signed} (${bytes.length} bytes, sha256:${actual})`);
      return;
    }
    if (Date.now() > deadline) {
      die(
        `gave up after ${timeoutMinutes} minutes; the file is still ${verdict.status}.\n` +
          '  Re-run this workflow against the same tag once AMO has signed it.',
      );
    }
    log(`not signed yet (${attempt}): ${verdict.status}; next look in ${intervalMs / 1000}s`);
    await sleep(intervalMs);
  }
};

const main = async () => {
  const { values } = parseArgs({
    options: {
      channel: { type: 'string', default: 'listed' },
      'expect-version': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'timeout-minutes': { type: 'string', default: '15' },
    },
    strict: true,
  });
  const channel = values.channel;
  if (!CHANNELS.includes(channel)) {
    die(`--channel must be one of ${CHANNELS.join(', ')}, got ${JSON.stringify(channel)}`);
  }
  const timeoutMinutes = Number(values['timeout-minutes']);
  if (!(timeoutMinutes > 0)) die('--timeout-minutes must be a positive number');
  const version =
    values['expect-version'] ??
    JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

  // Everything that can refuse without a credential refuses first.
  const archives = locateArchives(version);
  checkManifest(archives.extension, version);
  log(
    `${path.basename(archives.extension)} + ${path.basename(archives.sources)} → ${channel}` +
      (values['dry-run'] ? ' (dry run)' : ''),
  );

  const creds = credentials();
  runWxtSubmit({ ...archives, channel, dryRun: values['dry-run'], creds });
  if (values['dry-run']) {
    log('dry run: authenticated and found the add-on; nothing was uploaded.');
    return;
  }
  if (channel === 'listed') {
    log(`${version} is uploaded on the listed channel. Review is Mozilla's and arrives by email.`);
    log('Nothing to attach: AMO hosts the file.');
    return;
  }
  await fetchSigned({ version, channel, signed: archives.signed, creds, timeoutMinutes });
};

try {
  await main();
} catch (error) {
  console.error(`amo-submit: ${error instanceof SubmitError ? error.message : error.stack}`);
  // Not `process.exit`: it abandons pending stdout writes on a pipe.
  process.exitCode = 1;
}
```

- [ ] **Step 6: `scripts/amo-probe.mjs`**

```js
/**
 * Asks Firefox Add-ons what it holds for this extension, and prints the
 * answer. Reads only — uploads nothing, changes nothing.
 *
 *   pnpm amo:probe
 *
 * Credentials as in `amo-submit.mjs`: `FIREFOX_JWT_ISSUER`/`FIREFOX_JWT_SECRET`
 * from the environment, else 1Password. The JWT helper and the `op read` are
 * repeated here rather than shared, on purpose and for the same reason
 * `store-probe.mjs` repeats the token exchange: the *decisions* are shared and
 * unit-tested in `lib/amo.mjs`, and this file has to be readable on its own by
 * someone deciding whether it is safe to run against a live listing. What is
 * duplicated is one header, not a predicate.
 *
 * **Why this exists.** `readSignedFile` reads `channel`, `file.status`,
 * `file.url` and `file.hash` off a version-detail response, and those names
 * come from the API documentation rather than from a response this
 * repository has seen. Run this after the first submission and compare what
 * it prints against what the unlisted path expects, before the first unlisted
 * release relies on it.
 */
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import {
  AMO_ORIGIN,
  claimSet,
  endpoints,
  GECKO_ID,
  issuerLooksValid,
  readSignedFile,
  signingInput,
} from './lib/amo.mjs';

const OP_ISSUER = 'op://Personal/Firefox AMO Token/username';
const OP_SECRET = 'op://Personal/Firefox AMO Token/password';

const readOp = (reference) => {
  try {
    return execFileSync('op', ['read', reference], { maxBuffer: 1 << 20 }).toString().trim();
  } catch (error) {
    throw new Error(
      `could not read ${reference} from 1Password: ${error.message.split('\n')[0]}\n` +
        '  Sign in with `op signin`, or set FIREFOX_JWT_ISSUER and FIREFOX_JWT_SECRET.',
    );
  }
};

const credentials = () => {
  const issuer = process.env.FIREFOX_JWT_ISSUER?.trim() || readOp(OP_ISSUER);
  const secret = process.env.FIREFOX_JWT_SECRET?.trim() || readOp(OP_SECRET);
  if (!issuerLooksValid(issuer)) {
    throw new Error('FIREFOX_JWT_ISSUER does not look like an AMO API key (user:<id>:<key>)');
  }
  if (!secret) throw new Error('FIREFOX_JWT_SECRET is empty');
  return { issuer, secret };
};

const token = ({ issuer, secret }) => {
  const input = signingInput(
    claimSet({ issuer, now: Math.floor(Date.now() / 1000), jti: randomUUID() }),
  );
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
};

const get = async (url, creds) => {
  const response = await fetch(url, { headers: { Authorization: `JWT ${token(creds)}` } });
  const body = await response.json().catch(() => ({}));
  console.log(`GET ${url.replace(AMO_ORIGIN, '')} → HTTP ${response.status}`);
  return { response, body };
};

const main = async () => {
  const creds = credentials();
  const api = endpoints(GECKO_ID);

  const addon = await get(api.addon, creds);
  if (addon.response.status === 404) {
    console.log(JSON.stringify(addon.body));
    console.log(
      '\namo-probe: the add-on does not exist on AMO yet. The first submission is by\n' +
        '  hand — docs/store/amo/checklist.md — and nothing in this repository creates it.',
    );
    process.exitCode = 1;
    return;
  }
  if (!addon.response.ok) {
    console.log(JSON.stringify(addon.body, null, 2));
    process.exitCode = 1;
    return;
  }
  const a = addon.body;
  console.log(`  status:    ${a.status}   slug: ${a.slug}   guid: ${a.guid}`);
  console.log(
    `  listed:    ${a.current_version?.version ?? '(none)'}   unlisted: ${a.latest_unlisted_version?.version ?? '(none)'}`,
  );

  const versions = await get(`${api.versions('all_with_unlisted')}&page_size=5`, creds);
  if (!versions.response.ok) {
    console.log(JSON.stringify(versions.body, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log('\n--- what the unlisted path would read, per version ---');
  for (const v of versions.body.results ?? []) {
    const verdict = readSignedFile(v, { channel: v.channel });
    const detail = verdict.kind === 'refused' ? ` (${verdict.reason})` : '';
    console.log(
      `  ${v.version}  ${v.channel}  file: ${v.file?.status ?? '(none)'}  created: ${v.file?.created ?? '?'}  → ${verdict.kind}${detail}`,
    );
  }
  console.log(
    '\n  `ready` is what amo-submit.mjs downloads; `refused` on a version AMO shows as\n' +
      '  signed means scripts/lib/amo.mjs no longer matches the API. Read the JSON\n' +
      '  above before the first unlisted release.',
  );
};

try {
  await main();
} catch (error) {
  console.error(`amo-probe: ${error.message}`);
  process.exitCode = 1;
}
```

- [ ] **Step 7: 거부 경로를 자격 증명 없이 확인한다**

```bash
node scripts/amo-submit.mjs --channel nightly; echo "exit $?"
node scripts/amo-submit.mjs --expect-version 9.9.9; echo "exit $?"
node scripts/amo-submit.mjs --bogus; echo "exit $?"
```

Expected: 순서대로 `--channel must be one of listed, unlisted` / `no archive at …headerlab-9.9.9-firefox.zip` / parseArgs 의 unknown-option 스택 — 셋 다 `exit 1`, 셋 다 1Password 를 건드리지 않는다 (`op` 프롬프트가 뜨지 않는다).

- [ ] **Step 8: 진짜 AMO 에 dry-run 을 쳐서 배선을 확인한다**

```bash
node scripts/amo-submit.mjs --dry-run; echo "exit $?"
pnpm amo:probe; echo "exit $?"
```

Expected: 첫 줄은 `amo-submit: headerlab-1.7.0-firefox.zip + headerlab-1.7.0-sources.zip → listed (dry run)`, 그다음 `wxt submit …` 이 돌고 publish-extension 이 **애드온을 찾지 못해** 실패 (AMO 의 `Not found` — 스펙 §2 의 404), `amo-submit: wxt submit exited 1…`, `exit 1`. 두 번째는 `GET /api/v5/addons/addon/headerlab@say8425.github.io/ → HTTP 404` 와 "first submission is by hand" 문장, `exit 1`. 둘 다 **인증은 통과**한 결과다 (401 이 아니라 404). 어느 쪽 출력에도 issuer·secret 값이 없는지 눈으로 확인한다. 리포트에는 HTTP 코드만 적는다.

- [ ] **Step 9: 정리·검증**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm exec vitest run tests/unit/amo.test.ts tests/unit/manifest.test.ts tests/unit/bundle.test.ts`
Expected: 모두 초록. (`manifest`/`bundle` 은 Step 4 의 `pnpm zip` 이 방금 빌드했으므로 신선하다.)

- [ ] **Step 10: 커밋**

```bash
git add package.json wxt.config.ts .gitignore scripts/amo-submit.mjs scripts/amo-probe.mjs
git commit -F - <<'EOF'
feat: zip three archives, and submit the Firefox one to AMO with wxt submit

`pnpm zip` now writes the Chrome zip, the Firefox zip and the sources
archive AMO reviews (docs/ excluded — no build input there). `amo-submit.mjs`
is the one entry point for the developer's machine and CI: it checks the
archive is the version being submitted, runs `wxt submit` with credentials
from the environment or 1Password, and on the unlisted channel waits for
the signed xpi and verifies its hash. `amo-probe.mjs` reads the listing
back so the field names the unlisted path relies on can be checked against
a real response.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X7XpCj1bESKpE1VkojMAis
EOF
```

---

### Task 3: 워크플로 — `cws-submit.yml` 개명, `amo-submit.yml` 신설, 릴리스 잡이 둘을 부른다

**Files:**
- Rename: `.github/workflows/store-submit.yml` → `.github/workflows/cws-submit.yml` (`git mv`)
- Create: `.github/workflows/amo-submit.yml`
- Modify: `.github/workflows/release-please.yml`, `scripts/pack-crx.mjs:21`, `docs/store/checklist.md` (파일명 세 곳)
- Test: `tests/unit/storeSubmit.test.ts` (전면 교체)

**Interfaces:**
- Consumes: Task 2 의 `node scripts/amo-submit.mjs --channel <c> --expect-version <v>` (env `FIREFOX_JWT_ISSUER`/`FIREFOX_JWT_SECRET`); `scripts/lib/amo.mjs` 의 `GECKO_ID`.
- Produces: 릴리스 잡 출력 `extension_released`/`extension_tag`/`extension_version` 을 두 재사용 워크플로가 받는다 (이름 그대로). 환경 `firefox-amo` 의 시크릿 `FIREFOX_JWT_ISSUER`·`FIREFOX_JWT_SECRET`, 변수 `FIREFOX_CHANNEL` (Task 7 이 만든다).

**Ruling (스펙 §4 에서 한 곳 좁힘):** 스펙은 `FIREFOX_EXTENSION_ID` 를 "워크플로의 상수" 라 했지만, Task 2 의 스크립트가 이미 `GECKO_ID` 를 자식 env 로 넣으므로 YAML 에 한 번 더 두면 진실이 둘이 된다. id 는 `scripts/lib/amo.mjs` 한 곳에 두고, 가드는 **그 상수가 빌드된 Firefox manifest 의 id 와 같다** 로 잡는다. 틀리면 드는 비용: 없음 — 워크플로는 id 를 모른다.

- [ ] **Step 1: 실패하는 테스트 — `tests/unit/storeSubmit.test.ts` 를 통째로 바꾼다**

```ts
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
  it.each(STORES)('%s signs the released code by default, and can be pointed elsewhere', (_, yaml) => {
    expect(yaml).toContain('ref: ${{ inputs.ref || inputs.tag }}');
    // Declared under both triggers, so the expression resolves either way.
    expect(yaml.match(/^ {6}ref:$/gm)).toHaveLength(2);
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
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test 2>&1 | grep -E "storeSubmit|✓|✗|FAIL" | head -30`
Expected: `ENOENT … cws-submit.yml` 로 파일 전체가 FAIL. (`pnpm test` 인 이유: `readBuildFile('firefox', …)` 가 신선한 빌드를 요구한다.)

- [ ] **Step 3: 개명과 두 줄**

```bash
git mv .github/workflows/store-submit.yml .github/workflows/cws-submit.yml
```

`cws-submit.yml` 에서:
- 1행 `name: Store submit` → `name: Chrome Web Store submit`
- `run: gh release download "$TAG" --pattern '*.zip' --dir .output` → `--pattern '*-chrome.zip'`
- `run: node scripts/pack-crx.mjs .output/*.zip` → `.output/*-chrome.zip`
- "Take the archive from the release" 단계의 주석 끝에 한 줄 더한다:
  `# Named, not globbed: pnpm zip writes three archives now (Chrome, Firefox, sources).`

`scripts/pack-crx.mjs:21` 의 `.github/workflows/store-submit.yml` → `.github/workflows/cws-submit.yml`.

`docs/store/checklist.md` 의 `store-submit.yml` 세 곳 → `cws-submit.yml` (§10 둘, "Things that will not happen" 하나). §10 의 "then calls `store-submit.yml`, which signs that zip" 문장은 "then calls `cws-submit.yml`, which signs the Chrome zip into a CRX and submits it, and `amo-submit.yml`, which submits the Firefox zip and the sources archive to Firefox Add-ons (`amo/checklist.md` §8)" 로.

- [ ] **Step 4: `amo-submit.yml`**

```yaml
name: Firefox Add-ons submit

# Two triggers, and the second is the recovery path — the same shape as
# cws-submit.yml, for the same reason: release-please cuts the tag in its own
# step, so this runs with the release already irreversible, and a failure here
# is re-run against the same tag, never re-cut. AMO refuses a version it
# already holds, so a re-run after a partial success fails loudly rather than
# uploading twice.
#
# There is deliberately no `on: release`. release-please creates the release
# with the default GITHUB_TOKEN, and by GitHub's loop-prevention rule that
# event starts no workflow run at all.
on:
  workflow_call:
    inputs:
      tag:
        description: The extension release tag, e.g. extension-v1.8.0
        required: true
        type: string
      version:
        description: The version AMO must end up holding, e.g. 1.8.0
        required: true
        type: string
      channel:
        # A release never passes this: the environment's FIREFOX_CHANNEL
        # variable decides, and `listed` when that is unset. Declared here so
        # the expression below resolves under both triggers.
        description: Unused by a release. See the workflow_dispatch input of the same name.
        required: false
        type: string
      ref:
        description: Unused by a release. See the workflow_dispatch input of the same name.
        required: false
        type: string
  workflow_dispatch:
    inputs:
      tag:
        description: The extension release tag to submit, e.g. extension-v1.8.0
        required: true
        type: string
      version:
        description: The version AMO must end up holding, e.g. 1.8.0
        required: true
        type: string
      channel:
        description: listed (AMO hosts it) or unlisted (AMO signs it and the xpi is attached to the release)
        required: true
        type: choice
        options:
          - listed
          - unlisted
        default: listed
      ref:
        description: >-
          Which revision supplies the SCRIPTS. Leave empty to use the tag. Set it
          to main when the failure is in the scripts themselves — see the comment
          on the checkout step below.
        required: false
        type: string

permissions:
  contents: write

jobs:
  submit:
    runs-on: ubuntu-latest
    # wxt submit polls validation for up to ten minutes; on the unlisted
    # channel the script then waits up to fifteen more for the signature.
    timeout-minutes: 30

    # The environment is the whole authorization story for the API key.
    #
    # Environment secrets are readable ONLY by a job that names the environment,
    # and are read when that job starts rather than when the run is queued. The
    # deployment branch rule must be `Selected branches and tags → Ref type:
    # Branch → main`, exactly as chrome-web-store's is.
    #
    # The name below is pinned by tests/unit/storeSubmit.test.ts. A typo does
    # not fail — GitHub silently creates an environment with that name, with no
    # protection rules and no secrets, and the job runs ungated.
    environment: firefox-amo

    steps:
      # The checkout supplies the SCRIPTS and the dependency tree — the archives
      # come from the release, two steps down — so the two failure modes want
      # different revisions, the same two as the Chrome job: the tag by default,
      # so the archive check in amo-submit.mjs agrees with package.json; `ref:
      # main` when the failure is in the scripts and main still carries the
      # tag's version. docs/store/amo/checklist.md §8 carries the table.
      - uses: actions/checkout@v7
        with:
          ref: ${{ inputs.ref || inputs.tag }}
          persist-credentials: false

      # Unlike the Chrome job, this one installs: `wxt submit` is
      # publish-browser-extension, reached through node_modules. The job that
      # holds the credential is that much larger; the alternative is a second
      # AMO client in this repository.
      - uses: ./.github/actions/setup

      # An absent GitHub secret dereferences to an empty string rather than
      # failing. wxt submit would refuse it too — after the checkout and the
      # install — and the issuer's shape is the one cheap check that catches
      # the two secrets pasted into each other's slots.
      - name: Refuse to run without real AMO credentials
        env:
          ISSUER: ${{ secrets.FIREFOX_JWT_ISSUER }}
          SECRET: ${{ secrets.FIREFOX_JWT_SECRET }}
          CHANNEL: ${{ inputs.channel || vars.FIREFOX_CHANNEL || 'listed' }}
        run: |
          set -euo pipefail
          test -n "$SECRET" || { echo "FIREFOX_JWT_SECRET is empty"; exit 1; }
          case "$ISSUER" in
            user:[0-9]*:[0-9]*) ;;
            *) echo "FIREFOX_JWT_ISSUER is not an AMO API key (user:<id>:<key>)"; exit 1 ;;
          esac
          case "$CHANNEL" in
            listed|unlisted) ;;
            *) echo "channel must be listed or unlisted, got '$CHANNEL'"; exit 1 ;;
          esac
          echo "FIREFOX_CHANNEL=$CHANNEL" >> "$GITHUB_ENV"
          echo "submitting on the $CHANNEL channel"

      # The release's own archives, so what Mozilla reviews is what anyone can
      # download from the release page. Named, not globbed: there are three.
      - name: Take the archives from the release
        env:
          GH_TOKEN: ${{ github.token }}
          TAG: ${{ inputs.tag }}
        run: gh release download "$TAG" --pattern '*-firefox.zip' --pattern '*-sources.zip' --dir .output

      # One command, the same one a person types. It checks the archive is the
      # version being submitted, runs wxt submit, and on the unlisted channel
      # waits for the signature and writes the xpi. A green step on `listed`
      # means AMO validated the upload and created the version — approval is
      # Mozilla's and arrives by email. Nothing here publishes.
      - name: Submit to Firefox Add-ons
        env:
          FIREFOX_JWT_ISSUER: ${{ secrets.FIREFOX_JWT_ISSUER }}
          FIREFOX_JWT_SECRET: ${{ secrets.FIREFOX_JWT_SECRET }}
          VERSION: ${{ inputs.version }}
        run: node scripts/amo-submit.mjs --channel "$FIREFOX_CHANNEL" --expect-version "$VERSION"

      # Only on unlisted, and only after AMO signed it — on listed, AMO hosts
      # the file and there is nothing to attach. `--clobber` because a re-run
      # of this workflow is the recovery path.
      - name: Attach the signed package to the release
        if: env.FIREFOX_CHANNEL == 'unlisted'
        env:
          GH_TOKEN: ${{ github.token }}
          TAG: ${{ inputs.tag }}
        run: gh release upload "$TAG" .output/*.xpi --clobber
```

- [ ] **Step 5: `release-please.yml`**

(a) `- run: pnpm zip` 위 주석을 이것으로 바꾼다:

```yaml
      # `wxt zip` builds first, so there is no separate build step. Three
      # archives: the Chrome zip, the Firefox zip, and the sources archive AMO's
      # reviewers rebuild and diff against the Firefox package. The version in
      # each file name comes from package.json, which the release PR has already
      # bumped by the time that PR's merge lands here.
```

(b) 첨부 단계의 `name:` 을 `Attach the archives to the release` 로 바꾸고, 그 위에 주석을 둔다:

```yaml
      # All three. The sources archive goes on the release too, so what Mozilla
      # reviews is what anyone can download — and amo-submit.yml takes it from
      # here rather than rebuilding it.
```

(c) 파일 끝의 `store-submit` 잡과 그 위 주석 블록을 통째로 이것으로 바꾼다:

```yaml
  # A store submission cannot be its own workflow triggered by the release.
  # release-please creates that release with the default GITHUB_TOKEN, and
  # GitHub's loop-prevention rule means such an event starts no workflow run —
  # `release` and `push` are not among the exceptions. So each is a job in this
  # run, and both store workflows are reusable rather than event-triggered.
  #
  # `workflow_call` also keeps GITHUB_REF at `refs/heads/main`, which is what
  # both environments' deployment branch rules name. A tag rule there would
  # match nothing while reading as strict.
  #
  # Two stores, two jobs, side by side: neither waits for the other, and one
  # going red says nothing about the other. Each is gated by its own
  # environment and reads only its own credentials.
  cws-submit:
    needs: release-please
    if: ${{ needs.release-please.outputs.extension_released }}
    uses: ./.github/workflows/cws-submit.yml
    with:
      tag: ${{ needs.release-please.outputs.extension_tag }}
      version: ${{ needs.release-please.outputs.extension_version }}
    secrets: inherit

  amo-submit:
    needs: release-please
    if: ${{ needs.release-please.outputs.extension_released }}
    uses: ./.github/workflows/amo-submit.yml
    with:
      tag: ${{ needs.release-please.outputs.extension_tag }}
      version: ${{ needs.release-please.outputs.extension_version }}
    secrets: inherit
```

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test`
Expected: 모두 초록; `storeSubmit.test.ts` 21 tests PASS.

- [ ] **Step 7: 변이 검증 (셋, 각각 되돌린다)**

1. `cws-submit.yml` 의 `--pattern '*-chrome.zip'` 을 `--pattern '*.zip'` 으로 → "downloads and packs *-chrome.zip" FAIL.
2. `amo-submit.yml` 의 `environment: firefox-amo` 를 `firefox-addons` 로 → "names exactly the environment" FAIL.
3. `release-please.yml` 의 `amo-submit:` 잡 전체를 지움 → "calls amo-submit after the release job" FAIL.

각 변이는 줄 번호로 심고 `sed -n` 으로 심긴 것을 확인한 뒤 실행하고, 되돌린 뒤 `git diff --stat` 이 그 파일을 보이지 않는지 확인한다. (`pnpm exec vitest run tests/unit/storeSubmit.test.ts` — Step 6 직후라 빌드가 신선하므로 bare 실행이 허용된다.)

- [ ] **Step 8: 커밋**

```bash
git add .github/workflows/cws-submit.yml .github/workflows/amo-submit.yml .github/workflows/release-please.yml scripts/pack-crx.mjs docs/store/checklist.md tests/unit/storeSubmit.test.ts
git commit -F - <<'EOF'
ci: merging the release PR now submits the Firefox build to Firefox Add-ons

A second reusable workflow, gated by its own `firefox-amo` environment,
called beside the Chrome one. It takes the Firefox zip and the sources
archive from the release and runs `scripts/amo-submit.mjs`; on the
unlisted channel it attaches the signed xpi. `store-submit.yml` becomes
`cws-submit.yml` and names `*-chrome.zip` now that three archives exist.
The guards pin both environment names, credential isolation, step order,
the channel's resolution, and that the id submitted is the id built.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X7XpCj1bESKpE1VkojMAis
EOF
```

---

### Task 4: `docs/store/amo/` — 리스팅 런북과 문안, 그리고 문안 가드

**Files:**
- Create: `docs/store/amo/README.md`, `docs/store/amo/checklist.md`, `docs/store/amo/listing.md`, `docs/store/amo/description.en.md`, `docs/store/amo/reviewer-notes.md`
- Modify: `docs/store/README.md` (표에 행 하나), `docs/store/checklist.md` ("Things that will not happen" 에 괄호 한 문장)
- Test: `tests/unit/storeListing.test.ts` (describe 하나 추가)

**Interfaces:**
- Consumes: `docs/store/description.en.md` 의 Chrome 문안 (그대로 기준), `docs/store/assets/` 의 다섯 스크린샷, Task 2 의 `pnpm amo:submit`/`pnpm amo:probe`, Task 3 의 `amo-submit.yml`.
- Produces: `docs/store/amo/checklist.md` §7 의 README diff 를 게시 뒤 오너가 적용한다; Task 6 의 CLAUDE.md 가 이 디렉터리를 가리킨다.

- [ ] **Step 1: 실패하는 테스트 — `tests/unit/storeListing.test.ts` 끝에 추가**

`describe('the summary table in listing.md', …)` 블록 **앞**에 넣는다 (`description`, `skeleton`, `VERBATIM`, `MARKDOWN` 을 그대로 쓴다):

```ts
/** The Firefox Add-ons description, out of its fenced block. */
function amoDescription(): string {
  const file = path.join(STORE, 'amo', 'description.en.md');
  const fenced = /```text\n([\s\S]*?)\n```/.exec(readFileSync(file, 'utf8'));
  if (!fenced) throw new Error('docs/store/amo/description.en.md has no ```text block.');
  return fenced[1]!;
}

/**
 * The AMO copy is the Chrome copy with its Chrome-specific words made
 * browser-neutral and the agent bridge marked Chrome-only. Holding it to the
 * same three rules is the easy half; the fourth test is what stops the two
 * listings drifting into two products — every line the AMO copy carries that
 * the Chrome copy does not is listed, by name, and there are exactly four.
 */
describe('the Firefox Add-ons description', () => {
  it('keeps its shape — the Chrome copy with the two agent paragraphs folded into one', () => {
    expect(skeleton(amoDescription())).toBe('T_T_BBBBB_T_T_T_BBBB_T_T');
  });

  it('spells every API name, licence, URL and button label as the product does', () => {
    const text = amoDescription();
    const missing = VERBATIM.filter(([, pattern]) => !pattern.test(text)).map(([what]) => what);
    expect(missing, 'missing from amo/description.en.md').toEqual([]);
  });

  it('carries no Markdown — AMO would render some of it, and the same plain text goes to both stores', () => {
    const leaks = amoDescription()
      .split('\n')
      .flatMap((line) =>
        MARKDOWN.filter(([, pattern]) => pattern.test(line)).map(([what]) => `${what}: ${line}`),
      );
    expect(leaks, 'Markdown in amo/description.en.md').toEqual([]);
  });

  it('differs from the Chrome copy on exactly the four lines the spec names', () => {
    const chromeLines = new Set(description('en').split('\n'));
    const foreign = amoDescription()
      .split('\n')
      .filter((line) => !chromeLines.has(line));
    expect(foreign).toEqual([
      "HeaderLab sets, appends and removes HTTP request and response headers on the sites you choose, using the browser's own declarativeNetRequest engine. It holds no access to any site until you grant it.",
      "• Filter by request type. Eight request types, each its own checkbox, main_frame included — which the browser's own default quietly leaves out.",
      "HeaderLab ships an optional command line tool and a skill for Claude Code and Codex, so an agent can read and change your header rules while it works. That bridge is Chrome-only for now: Firefox closes native-messaging ports when an extension's event page goes idle, so this Firefox build does not offer it and asks for no nativeMessaging permission.",
      "• Nothing leaves your machine. Your rules live in the browser's own extension storage.",
    ]);
  });

  it('says the bridge is Chrome-only, and names Chrome nowhere else', () => {
    const text = amoDescription();
    expect(text).toContain('Chrome-only');
    // `Chrome's` is the possessive every browser-specific sentence in the
    // Chrome copy used; none of them may survive here.
    expect(text).not.toContain("Chrome's");
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm exec vitest run tests/unit/storeListing.test.ts`
Expected: 새 describe 다섯이 `ENOENT … docs/store/amo/description.en.md` 로 FAIL, 기존 다섯은 PASS. (이 파일의 summary 테스트는 빌드를 읽는다 — Task 3 의 `pnpm test` 직후라 신선하다. 아니면 `pnpm test`.)

- [ ] **Step 3: `docs/store/amo/description.en.md`**

````markdown
# Detailed description — Firefox Add-ons, English

Paste the block below into **Describe Add-on → Description** in the Developer
Hub. It is plain text: AMO renders a little Markdown and Chrome renders none,
so the same plain text goes to both and the bullets and headings are literal
characters here as there.

```text
HeaderLab sets, appends and removes HTTP request and response headers on the sites you choose, using the browser's own declarativeNetRequest engine. It holds no access to any site until you grant it.

WHAT IT DOES

• Set, append or remove any header, on the request side or the response side.
• Scope by site. Sites are matched by host, so what the popup shows is what goes on the wire.
• Apply everywhere, as an explicit mode. It costs access to all sites, and the switch does not ask for it — a separate Grant button does.
• Filter by request type. Eight request types, each its own checkbox, main_frame included — which the browser's own default quietly leaves out.
• Pause everything with one switch. The toolbar icon greys out to match, and stays grey across a restart.

DRIVE IT FROM AN AI CODING AGENT

HeaderLab ships an optional command line tool and a skill for Claude Code and Codex, so an agent can read and change your header rules while it works. That bridge is Chrome-only for now: Firefox closes native-messaging ports when an extension's event page goes idle, so this Firefox build does not offer it and asks for no nativeMessaging permission.

WHAT IT DOES NOT DO

• No network calls. No analytics, no telemetry, no remote configuration, no update pings.
• No content scripts. Nothing is injected into any page, and the extension never sees a page's contents.
• No remote code, no CDN, no web fonts, no remote images. Nothing is fetched from outside the package.
• Nothing leaves your machine. Your rules live in the browser's own extension storage.

https://github.com/say8425/headerlab

Open source, Apache-2.0.
```

## How this differs from the Chrome copy, line by line

`../description.en.md` is the source; this is that text with four lines
changed and one removed. `tests/unit/storeListing.test.ts` lists the four
verbatim and fails on a fifth, so edit the Chrome copy first and carry the
change here — not the other way round.

| Chrome | Here | Why |
| --- | --- | --- |
| using Chrome's own declarativeNetRequest engine | using the browser's own declarativeNetRequest engine | Firefox has the same engine under the same name |
| Eight of Chrome's resource types … which Chrome's own default quietly leaves out | Eight request types … which the browser's own default quietly leaves out | The checklist offers the same eight on both; main_frame is off by default in both |
| Two agent paragraphs: the tool, then "It costs you no control" | One paragraph: the tool, then "That bridge is Chrome-only for now …" | A Firefox user cannot use it; selling it above the fold would be the listing lying. The reason is one clause, measured in docs/research/2026-09-08-firefox-marionette-spike.md |
| Your rules live in Chrome's own extension storage | Your rules live in the browser's own extension storage | `browser.storage.local` on Firefox |

Everything else is byte-identical, on purpose: the owner cut the Chrome copy to
this shape on 2026-08-22 and every argument in `../description.en.md`'s notes
applies here unchanged — no competitor named, every claim checkable from the
package, nothing repeated for search.
````

- [ ] **Step 4: `docs/store/amo/listing.md`**

````markdown
# Firefox Add-ons — the listing form

Every field the Developer Hub asks for on a listed submission, with its value.
The detailed description is beside this file as `description.en.md`; the
privacy policy is `../../../PRIVACY.md`, pasted; reviewer notes are
`reviewer-notes.md`.

## Fields read out of the package

| What the visitor sees | Where it comes from | Current value |
| --- | --- | --- |
| Name | `manifest.name` | `HeaderLab` |
| Summary (pre-filled, editable) | `manifest.description` | the string in `../listing.md` — 119 characters against AMO's limit of **250** |
| Data collection | `browser_specific_settings.gecko.data_collection_permissions` | `none` — the listing says the extension collects no data, and there is no form field for it |
| Version, permissions | the manifest | shown as uploaded |

AMO's summary limit is 250 characters; Chrome's is 132, and
`tests/unit/manifest.test.ts` pins the shipped string under the smaller one, so
whatever passes for Chrome fits here. The string itself and its measured length
are in `../listing.md`, compared against the built manifest by
`tests/unit/storeListing.test.ts` — one row, one place.

## Fields on the form

| Field | Value |
| --- | --- |
| Add-on URL (slug) | `headerlab` — measured free on 2026-09-09 (`GET /api/v5/addons/addon/headerlab/` → 404) |
| Description | `description.en.md`, the fenced block, as plain text |
| Categories | **Web Development** (slug `web-development`). The second of the two slots is left empty, as Chrome's single category is; `privacy-security` is the candidate if the owner wants one |
| Support email | none — the Chrome listing has none either. Owner's call |
| Support website | `https://github.com/say8425/headerlab/issues` |
| Homepage | `https://github.com/say8425/headerlab` |
| License | **Apache License 2.0** (slug `Apache-2.0`) |
| Privacy policy | the body of `../../../PRIVACY.md`, pasted. **Text, not a URL** — this is the first thing that differs from Chrome's form |
| Notes to reviewer | `reviewer-notes.md` |
| Compatibility | Firefox desktop only. Do not tick Firefox for Android: the popup is 748×600 and was never measured on a phone |
| This add-on is experimental / requires payment | No / No |
| Tags | none |

## Images

| Slot | File | Size | Note |
| --- | --- | --- | --- |
| Icon | `../../../public/icon/active-128.png` | 128×128 | Full bleed. AMO does not ask for the 16px padding the Chrome store does and draws icons edge to edge in a rounded frame; the padded `../assets/store-icon-128.png` would read smaller than its neighbours. Same glyph — swap it if the two stores should match |
| Screenshots | `../assets/screenshot-{1..5}-*.png` | 1280×800 | AMO's own recommendation is 1280×800, "the maximum image display size". Upload in numeric order |

### Screenshot order and captions

The captions are AMO's, per image, and are the "What it shows" column of
`../listing.md` with one word changed where a Chrome-only thing was named.

| # | File stem | Caption |
| --- | --- | --- |
| 1 | `screenshot-1-scoped` | Four rules across two granted sites — the ordinary working state |
| 2 | `screenshot-2-permission` | A pending site, amber, with its Grant button |
| 3 | `screenshot-3-blocked` | A rule the browser would refuse, named on its own row, counted 1 blocked |
| 4 | `screenshot-4-allsites` | All-sites mode on, permission not held, saved sites reading "All sites is on" |
| 5 | `screenshot-5-dark` | The same popup following a dark OS theme |

### What the screenshots do not show, and one thing they show that Firefox does not

Everything `../listing.md` says under "What the screenshots do not claim"
holds here: the granted rows were staged through a patched manifest, shot 4's
rows are `idle` on purpose, shot 2's pending row is genuine.

**And the five are photographs of the Chrome popup.** Each carries the agent
bridge row at the bottom of the rail, and the Firefox popup renders no such row
(the build declares no `nativeMessaging` and the popup does not offer the
bridge — CLAUDE.md, "Non-negotiables"). Reused on the owner's instruction,
2026-09-10, because the rest of the popup is pixel-identical and the store's
recommended size is exactly what they are. The captions above do not mention
the row. Photographing the Firefox popup is a recorded follow-up:
`tests/support/firefox.ts` already has a `screenshot()` that produced the
images in the Firefox support PR (#86).
````

- [ ] **Step 5: `docs/store/amo/reviewer-notes.md`**

````markdown
# Notes to reviewer

Paste the block below into **Notes to Reviewer** on every submission — the
first by hand, and thereafter it is what `amo-submit.yml` cannot fill in for
you (publish-browser-extension sends no `approval_notes`), so add it in the
Hub when a reviewer asks. The sources archive is required because the package
is bundled, and Mozilla's rule is that a reviewer rebuilds it and diffs: "There
must be no differences."

```text
Built with WXT 0.21 (Vite) and Tailwind CSS v4, so the package is bundled; the sources archive is the repository at the release tag, produced by `wxt zip -b firefox`, with docs/ left out (no build input there).

To reproduce, on any OS with Node 24 (the repository pins it in .nvmrc, which the archive omits as a dotfile):

  corepack enable                    # pnpm 11.20.0, from package.json's packageManager field
  pnpm install --frozen-lockfile
  pnpm build:firefox                 # → .output/firefox-mv3/

The contents of .output/firefox-mv3/ are the uploaded package. The build is deterministic: same lockfile, same output.

The extension makes no network calls. `grep -rE 'fetch\(|XMLHttpRequest|WebSocket|sendBeacon' .output/firefox-mv3` returns nothing, and tests/unit/bundle.test.ts in the archive asserts the same against every build. It declares no host permissions at install; access is requested per site at runtime through optional_host_permissions.
```

If a reviewer reports a difference, the first suspects are the Node major and
the lockfile — nothing in the build reads the clock or the environment. The
owner declined an automated reproduction check before the tag (2026-09-10), so
a reviewer's diff is the first measurement of this claim; CLAUDE.md's Known
gaps says so.
````

- [ ] **Step 6: `docs/store/amo/checklist.md`**

````markdown
# Firefox Add-ons — submission checklist

Run top to bottom, once. Steps 1 and 2 are account work; step 3 is the one
submission a person makes; from step 8 on, merging the release PR does it.

Everything to paste lives beside this file:

| File | Covers |
| --- | --- |
| `listing.md` | Every field on the form, the images, the screenshot captions |
| `description.en.md` | The detailed description |
| `reviewer-notes.md` | Notes to Reviewer — how to rebuild the package |
| `../../../PRIVACY.md` | The privacy policy, pasted as text |
| `../assets/` | The five screenshots, shared with the Chrome listing |

---

## 1. Account and API key

- [ ] A Firefox Account, signed in at <https://addons.mozilla.org/developers/>.
      AMO requires two-factor authentication on developer accounts; set it up
      before the first submission rather than being stopped by it mid-form.
- [ ] Accept the **Firefox Add-on Distribution Agreement** the first time the
      Hub asks. The API refuses uploads until this is done — measured on
      2026-09-09, the profile endpoint answered `is_addon_developer: false` for
      this account, which is what "never submitted" looks like.
- [x] API credentials — <https://addons.mozilla.org/developers/addon/api/key/>
      — generated 2026-09-09 and stored in 1Password as **Firefox AMO Token**
      (Personal vault): `username` is the JWT issuer (`user:<id>:<key>`),
      `password` is the JWT secret. `pnpm amo:probe` reads them from there and
      proves they work: a `200` on the profile, then a `404` on the add-on
      until step 3 creates it.

---

## 2. Prepare the archives

- [ ] `pnpm check:all` and `pnpm test:e2e` — the same gates as Chrome.
- [ ] `pnpm zip` → three files. **Clear the old ones first**; `wxt zip` does
      not remove them, and every command below names its archive rather than
      globbing precisely because a leftover wins (`../checklist.md` §2 records
      why `find`, not `rm -f`):

      ```bash
      V=$(node -p "require('./package.json').version")
      find .output -maxdepth 1 -name '*.zip' -delete 2>/dev/null; pnpm zip && ls -l .output/*.zip
      ```

      Expect `headerlab-$V-chrome.zip`, `-firefox.zip` and `-sources.zip`.

- [ ] Confirm the Firefox archive carries the gecko block and the two
      install-time permissions, and no `host_permissions`:

      ```bash
      V=$(node -p "require('./package.json').version")
      unzip -p ".output/headerlab-$V-firefox.zip" manifest.json | python3 -m json.tool
      ```

      `browser_specific_settings.gecko.id` must be `headerlab@say8425.github.io`,
      `permissions` exactly `["storage", "declarativeNetRequestWithHostAccess"]`,
      `optional_permissions` absent. `tests/unit/manifest.test.ts` pins all of
      it, so a green `pnpm check` already proves this; the command is here
      because it is the one claim the listing rests on.

- [ ] Confirm the sources archive carries no `docs/` and does carry the lockfile:

      ```bash
      V=$(node -p "require('./package.json').version")
      unzip -Z1 ".output/headerlab-$V-sources.zip" | grep -c '^docs/'        # must be 0
      unzip -Z1 ".output/headerlab-$V-sources.zip" | grep -c '^pnpm-lock.yaml$'  # must be 1
      ```

      Both lines, not just the first: an absence check alone passes on a
      missing archive.

---

## 3. The first submission — by hand, and the order matters

`wxt submit` begins by fetching the add-on, so it cannot create one; and AMO
refuses a version it already holds. So:

- [ ] **Do this before merging the extension's next release PR.** The archives
      from step 2 carry the version `main` is at (1.7.0 as of 2026-09-10 — the
      Firefox support is on `main`, only the version string is old), and that
      is the version to submit by hand. The next release (1.8.0) is then the
      first one `amo-submit.yml` uploads. Merge the release first and the 1.8.0
      job goes red on a 404 — designed, there is no add-on — and after 1.8.0 is
      uploaded by hand, a dispatch re-run is refused as a duplicate, so the
      automated path's first run slips to 1.9.0.
- [ ] Developer Hub → **Submit a New Add-on** → **On this site** (listed) or
      **On your own** (unlisted — the signed file comes back to you; see §8).
      Upload `headerlab-<version>-firefox.zip`.
- [ ] When asked whether the add-on uses build tools: **yes**, and upload
      `headerlab-<version>-sources.zip`. This is required, not optional — the
      package is bundled — and a reviewer rebuilds it (`reviewer-notes.md`).
- [ ] Let validation finish before filling anything in.

---

## 4. Describe the add-on

Work through `listing.md`. In short:

- [ ] Name comes from the manifest; leave it.
- [ ] Add-on URL: `headerlab`.
- [ ] Summary is pre-filled from the manifest; leave it (119 of 250).
- [ ] Description: `description.en.md`, as plain text.
- [ ] Categories: **Web Development**. Second slot: owner's call.
- [ ] Support website: `https://github.com/say8425/headerlab/issues`.
      Homepage: `https://github.com/say8425/headerlab`. Support email: owner's
      call; none on Chrome.
- [ ] License: **Apache License 2.0**.
- [ ] Icon: `public/icon/active-128.png` (`listing.md` says why not the padded
      one). Screenshots: the five, in order, with the captions from `listing.md`.
- [ ] Compatibility: Firefox desktop only.

---

## 5. Privacy policy

- [ ] Paste the body of `PRIVACY.md` into the **Privacy Policy** field. It is
      text here, not a URL. AMO accepts a little Markdown; look at the rendered
      page after publication and fix the file, not the field, if something
      reads wrong — the file is what the Chrome listing links to, and the two
      must say the same thing.
- [ ] The data-collection declaration needs nothing from you: it comes from the
      manifest (`data_collection_permissions: none`) and the listing renders it
      as "does not collect data".

---

## 6. Notes to reviewer

- [ ] Paste `reviewer-notes.md`'s block. The build instructions are also in the
      README inside the sources archive, under "Build it yourself" — a reviewer
      who reads only the archive still finds them.

---

## 7. After it is published

Kept as a diff to apply, because none of it may be written while the listing
does not exist — a badge for a missing add-on renders "not found" and a link to
it 404s. On the day the listing is live:

- [ ] `README.md` and `docs/README.{ko,ja,zh,es}.md`: under the Chrome Web
      Store badge, add

      ```markdown
      [![Firefox Add-ons](https://img.shields.io/amo/v/headerlab?logo=firefox&logoColor=%23FF7139&color=%23FF7139&label=firefox%20add-ons)](https://addons.mozilla.org/firefox/addon/headerlab/)
      ```

- [ ] The five Install sections: the intro line becomes "Chrome and Firefox
      from their stores. Safari is planned." (each in its own language); a new
      `### Firefox Add-ons` subsection goes first under Install, before Chrome
      Web Store or beside it, reading "Installing from
      [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/headerlab/) is
      the recommended route on Firefox."; and the `### Firefox` subsection's
      first sentence ("The Firefox Add-ons listing is in review …") is deleted,
      leaving the temporary-load instructions for people building from source.
- [ ] `docs/store/amo/README.md`: replace "not yet published" in its first
      paragraph with the listing URL.
- [ ] `gh repo edit --description` — the repository description still says
      "Chrome extension (MV3)".

---

## 8. Releasing from here on

Merging the release PR is the whole of it. `release-please.yml` cuts the tag,
attaches the three archives, and calls `cws-submit.yml` and `amo-submit.yml`
side by side. For Firefox:

- **A green run means AMO validated the upload and created the version.** On
  `listed`, approval is Mozilla's and arrives by email. On `unlisted`, the run
  has also waited for the signature and attached `headerlab-<v>-firefox.xpi`
  to the release.
- **The channel is the `firefox-amo` environment's `FIREFOX_CHANNEL` variable**
  (`listed` when unset). A manual `workflow_dispatch` run takes the channel as
  an input and wins over the variable. Unlisted installs do not auto-update:
  the manifest carries no `update_url`, by decision (spec §12).
- **Never re-cut a version to fix a store failure.** Same table as Chrome:

  | The failure was in | Do this |
  | --- | --- |
  | the network, the credentials, AMO | Re-run `amo-submit.yml` against the same tag, `ref` empty. AMO refuses a duplicate version, so a run that failed *after* creating the version cannot be repeated — check `pnpm amo:probe` first |
  | the scripts themselves | Fix on `main`, then re-run with `ref: main` while `main` still carries the tag's version |
  | the scripts, but `main` has moved on | Neither. `gh release download extension-v<v> -p '*-firefox.zip' -p '*-sources.zip' -D .output`, then `node scripts/amo-submit.mjs --expect-version <v>` locally — it reads the credentials from 1Password |

One-time setup, outside the repository (done 2026-09-10 through `gh`, values
never printed): environment `firefox-amo` with deployment branch rule
`Branch → main` and "Allow administrators to bypass" off, secrets
`FIREFOX_JWT_ISSUER` and `FIREFOX_JWT_SECRET` from the 1Password item,
variable `FIREFOX_CHANNEL=listed`.

---

## Things that will not happen, so do not wait for them

- **`amo-submit.yml` will not create the add-on.** That is §3, once.
- **Nothing here waits for a review verdict.** AMO emails; there is no webhook
  and `wxt submit` returns as soon as the version exists.
- **The sources archive is not checked for reproducibility before the tag.**
  Owner's call (2026-09-10): a reviewer's diff is the first measurement. If
  one ever comes back with differences, that is the day to add the check.
````

- [ ] **Step 7: `docs/store/amo/README.md`**

````markdown
# Firefox Add-ons (AMO) listing

Everything the Firefox Add-ons listing is made of, beside the Chrome Web
Store's in `../`. Not yet published: the first submission is a person's
(`checklist.md` §3), and until it lands nothing in the five READMEs points
here. The two listings share `../assets/` and almost all of their copy; what
differs is named below so nobody has to diff two runbooks.

**Start with [`checklist.md`](checklist.md).** It runs top to bottom, once;
its last section is the one that stays useful afterwards.

| File | What it is |
| --- | --- |
| [`checklist.md`](checklist.md) | The runbook: account, archives, the first submission by hand, the form, privacy, reviewer notes, after publication, releasing from here on |
| [`listing.md`](listing.md) | Every field on the form with its value, the images, the screenshot order and captions |
| [`description.en.md`](description.en.md) | The detailed description — the Chrome copy with its Chrome-specific words made neutral, and the agent bridge marked Chrome-only |
| [`reviewer-notes.md`](reviewer-notes.md) | Notes to Reviewer: how to rebuild the package from the sources archive |
| [`../../../PRIVACY.md`](../../../PRIVACY.md) | The privacy policy. AMO takes it as pasted text, not as a URL |
| `../assets/` | The five 1280×800 screenshots, generated for Chrome and reused |

## Three things that differ from the Chrome Web Store

**The privacy policy is pasted, not linked.** Chrome's form takes a URL and
this repository gives it `PRIVACY.md` on `main`; AMO's form takes the text.
Same file, and it is written for both.

**The sources archive is required, and it is reviewed by rebuilding.** The
package is bundled, so Mozilla's policy asks for the source and a reviewer
"uses a diff tool to compare the generated sources to those in the extension.
There must be no differences." `pnpm zip` writes `headerlab-<v>-sources.zip`
beside the package, the release attaches it, and `amo-submit.yml` uploads it
with every version. The README inside it, under "Build it yourself", is the
reviewer's instruction sheet.

**Only the first submission is by hand.** `wxt submit` — which is what
`amo-submit.yml` runs — starts by fetching the add-on and cannot create one. So
the first version goes through the Developer Hub with both archives, and every
version after it goes through the release workflow, on the channel the
`firefox-amo` environment names.

## What is reused, and its cost

The five screenshots are photographs of the Chrome popup and each shows the
agent bridge row, which the Firefox popup does not render. Reused on the
owner's instruction (2026-09-10); `listing.md` says what the captions leave
out and where the Firefox-side screenshot helper already is.
````

- [ ] **Step 8: 두 Chrome 문서에 한 줄씩**

`docs/store/README.md` 의 표 마지막 행(`assets/`) 아래에:

```markdown
| [`amo/`](amo/README.md) | The Firefox Add-ons listing — same assets, its own runbook; its README names the three things that differ |
```

`docs/store/checklist.md` 의 "Things that will not happen" 첫 불릿 끝에 문장 하나:

```markdown
  (Firefox is the opposite: `amo-submit.yml` is exactly a `wxt submit` step —
  `amo/checklist.md` §8.)
```

- [ ] **Step 9: 통과를 확인한다**

Run: `pnpm exec vitest run tests/unit/storeListing.test.ts tests/unit/storeAssets.test.ts`
Expected: 모두 PASS — 새 다섯 포함. `storeAssets` 는 `docs/store/assets/` 를 손대지 않았음을 확인한다.

- [ ] **Step 10: 변이 검증**

`docs/store/amo/description.en.md` 의 브릿지 문단에서 `Chrome-only` 를 `Chrome only` 로 바꾼다 → "says the bridge is Chrome-only" FAIL, 그리고 "differs … on exactly the four lines" 도 FAIL (문장이 달라졌으므로). 되돌린다.

- [ ] **Step 11: 커밋**

```bash
git add docs/store/amo docs/store/README.md docs/store/checklist.md tests/unit/storeListing.test.ts
git commit -F - <<'EOF'
docs: write the Firefox Add-ons listing runbook, reusing the Chrome copy

The runbook for the one submission a person makes and the releases that
follow, the form's fields with their values, the description as the Chrome
copy with four lines made browser-neutral and the bridge marked Chrome-only,
the reviewer notes that rebuild the package, and the README diff to apply
once the listing exists. The description is held to the Chrome rules and to
exactly those four lines.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X7XpCj1bESKpE1VkojMAis
EOF
```

---

### Task 5: `PRIVACY.md` 를 두 브라우저로, README 다섯 판의 설치 절을 지금 참인 문장으로

**Files:**
- Modify: `PRIVACY.md` (전면 교체), `README.md`, `docs/README.ko.md`, `docs/README.ja.md`, `docs/README.zh.md`, `docs/README.es.md`

**Interfaces:**
- Consumes: Task 2 의 `pnpm amo:submit`/`pnpm amo:probe` (Development 블록에 적는다), Task 4 의 `docs/store/amo/checklist.md` §7 (게시 뒤 diff 는 거기 있으므로 여기서는 뱃지·링크를 넣지 **않는다**).
- Guards that watch these files: `tests/unit/readmeLiterals.test.ts` (팝업 리터럴 다섯 — 건드리지 않는다), `packages/headerlab/test/docs.test.mjs` (bash 펜스의 `headerlab ` 명령 — 새 펜스 줄은 `pnpm` 으로 시작하므로 무관).

- [ ] **Step 1: `PRIVACY.md` 전면 교체**

```markdown
# HeaderLab Privacy Policy

_Last updated: 2026-09-10_

HeaderLab is a browser extension for Chrome and Firefox that adds, changes and
removes HTTP request and response headers on websites you choose.

**Nothing HeaderLab stores is sent to its developer, to any server, or to any
third party.** The extension makes no network calls of any kind.

This policy is short because there is little to describe. It is written anyway
because both stores ask for one. The Chrome Web Store requires an extension to
disclose how it handles user data "even when data is processed or stored locally
on a user's device and is not transmitted to external servers or third parties"
— which is exactly HeaderLab's situation — and Firefox Add-ons takes the same
policy as text on the listing. One document, the same words in both places.

## What HeaderLab stores

All of it is created by you, in the extension's own popup, and all of it stays
on your computer in your browser's extension storage — `chrome.storage.local`
in Chrome, `browser.storage.local` in Firefox:

- **Header rules** — the header name, the value, whether the rule applies to the
  request or the response, whether it sets, appends or removes, and whether it
  is switched on.
- **The site list** — the hostnames you have scoped your rules to, and whether
  "All sites" mode is on.
- **The request-type filter** — which of the browser's request types your rules
  apply to.
- **Switch positions** — whether the whole rule set is paused, and, in Chrome
  only, whether the optional agent bridge is enabled.
- **The last error**, if a rule set failed to register, so the popup can tell you
  why. This is the browser's own message, held in session storage and gone when
  the browser closes.

There are no accounts, no sign-in, and no identifiers of any kind. HeaderLab
does not know who you are.

## What HeaderLab does not collect

- **No analytics or telemetry.** No usage statistics, no crash reports, no
  installation pings.
- **No browsing history.** HeaderLab is never told which pages you visit. It
  only knows the hostnames you typed into it yourself.
- **No page contents.** Nothing is injected into any page. Headers are changed by
  the browser's own `declarativeNetRequest` engine, which applies your rules
  inside the browser and never hands request or response contents to the
  extension.
- **No remote code.** Nothing is downloaded or executed from outside the
  installed package.

The shipped bundle contains no call to `fetch`, `XMLHttpRequest`, `WebSocket`,
`sendBeacon` or `EventSource`. You do not have to take that on trust — build the
extension from source and search both outputs:

```bash
pnpm build
grep -rE 'fetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource' .output/chrome-mv3 .output/firefox-mv3
```

That returns nothing. An automated test asserts the same thing against every
build. On Firefox Add-ons, the listing's data-collection declaration — *none* —
comes from the extension's own manifest rather than from a form.

## One thing worth understanding

**A header value you enter is sent to the sites you scope it to.** That is what
the extension is for. If you create a rule that adds
`Authorization: Bearer abc123` and scope it to `api.example.com`, then the
browser attaches that header to requests going to `api.example.com`, exactly as
you asked.

Two consequences follow, and neither is hidden:

1. **You decide the destination.** A rule applies only to hosts you have granted
   access to, one at a time, through the Grant button in the popup. The value
   goes to that site and nowhere else. It is never sent to the developer.
2. **Values are stored as you typed them.** Your browser's extension storage is
   not encrypted by HeaderLab. Anyone with access to your browser profile on
   your computer can read the values you have saved. If a credential is one you
   would not want sitting in a local file, use a short-lived one.

## Site access

HeaderLab requests no host access when it is installed. Access to a site is
granted by you, per site, at the moment you press Grant, and the browser — not
HeaderLab — records that grant. You can withdraw it at any time, from
`chrome://extensions` in Chrome or `about:addons` in Firefox, without
uninstalling anything.

"All sites" mode is an explicit choice that needs access to all sites. Turning
the switch on does not request that access; a separate Grant button does, and
until you press it the popup says the mode is not in effect.

## The optional agent bridge

**Chrome only.** In Chrome, HeaderLab can optionally be driven from a terminal,
so that you — or a coding assistant working on your behalf — can change rules
without opening the popup.

It is **off** unless you turn it on, and it needs a separate helper program that
you install yourself. When it is on, the extension talks to that program through
Chrome's native messaging, and the program listens on a unix domain socket
inside your own user directory. **No network socket is involved and nothing
leaves your machine.** If you never turn the switch on, none of it runs.

The Firefox build does not offer the bridge and does not declare the
`nativeMessaging` permission: Firefox closes native-messaging ports when an
extension's event page goes idle, so the bridge as designed cannot run there.
The popup on Firefox shows no bridge switch.

## Retention and deletion

Data lives until you remove it. Deleting a rule removes it. Removing a site
removes it. Uninstalling HeaderLab removes everything the browser was holding
for the extension. There is no copy anywhere else to ask about.

## Children

HeaderLab is a developer tool. It is not directed at children and collects
nothing from anyone.

## Changes

If this policy changes, the new version is committed to the repository below and
the date at the top changes with it. The file's history is the changelog.

## Contact

Questions, or anything in this document that looks wrong:

- <https://github.com/say8425/headerlab/issues>
```

- [ ] **Step 2: `README.md` — Install 네 곳과 Development 두 줄**

(a) Install 도입 문장:

```markdown
Chrome from the store, Firefox from the release page while the Firefox Add-ons listing is in review. Safari is planned.
```

(b) `### Release page` 문단 전체:

```markdown
Every `extension-v*` release attaches three archives: `headerlab-<version>-chrome.zip`,
`headerlab-<version>-firefox.zip`, and `headerlab-<version>-sources.zip` — the source
archive Mozilla's reviewers rebuild, attached so anyone can see exactly what they got.
Take the Chrome asset for the version you want from the [releases page](../../releases),
unpack it, then `chrome://extensions` → **Developer mode** → **Load unpacked** → the
unpacked directory.
```

(c) `### Build it yourself` 의 코드 블록과 그 아래 문장:

````markdown
```bash
corepack enable          # pnpm comes from package.json's packageManager field
pnpm install
pnpm build               # → .output/chrome-mv3 and .output/firefox-mv3
```

Node 24 — `.nvmrc` pins it, and it is what CI and Mozilla's reviewers build with.
`pnpm build:firefox` builds the Firefox target alone; its output is byte for byte the
package on Firefox Add-ons. Load `.output/chrome-mv3` the same way.
````

(d) `### Firefox` 문단 전체:

```markdown
The Firefox Add-ons listing is in review; until it is live, release Firefox will not
install this permanently. Load it temporarily: `about:debugging` → **This Firefox** →
**Load Temporary Add-on** → either the release's `headerlab-<version>-firefox.zip` as it
is, or `.output/firefox-mv3/manifest.json` after `pnpm build`. It stays until Firefox
restarts. The agent bridge is not offered on Firefox — see Limitations.
```

(e) Development 블록: `pnpm build           # production build → .output/chrome-mv3` 를
`pnpm build           # production builds → .output/chrome-mv3 and .output/firefox-mv3` 로,
그리고 `pnpm store:assets` 줄 아래에:

```
pnpm amo:submit      # zip the Firefox build, then submit it to Firefox Add-ons (credentials from 1Password)
pnpm amo:probe       # read the Firefox Add-ons listing's state — uploads nothing
```

- [ ] **Step 3: `docs/README.ko.md`** — 같은 네 곳과 두 줄

(a) `크롬은 스토어에서, 파이어폭스는 Firefox Add-ons 리스팅이 심사 중인 동안 릴리즈 페이지에서. 사파리는 예정.`

(b) 릴리즈 페이지 문단:

```markdown
`extension-v*` 릴리즈마다 아카이브 셋이 첨부됩니다: `headerlab-<version>-chrome.zip`,
`headerlab-<version>-firefox.zip`, 그리고 Mozilla 리뷰어가 다시 빌드하는 소스 아카이브
`headerlab-<version>-sources.zip` — 그들이 받은 것을 누구나 볼 수 있도록 함께 붙입니다.
[릴리즈](https://github.com/say8425/headerlab/releases)에서 원하는 버전의 크롬 에셋 압축을 풀고
`chrome://extensions` → **개발자 모드** → **압축해제된 확장 프로그램을 로드합니다** →
압축 푼 디렉터리 선택.
```

(c) 직접 빌드 — 코드 블록은 그대로 두고 아래 문장을 이것으로:

```markdown
Node 24 — `.nvmrc` 가 고정하고, CI 와 Mozilla 리뷰어가 빌드하는 버전입니다. `pnpm build:firefox` 는
파이어폭스 타깃만 빌드하며, 그 출력이 Firefox Add-ons 에 올라간 패키지와 바이트 단위로 같습니다.
`.output/chrome-mv3` 를 같은 방법으로 로드합니다.
```

(d) 파이어폭스 문단:

```markdown
Firefox Add-ons 리스팅이 심사 중입니다. 게시되기 전까지 릴리스 파이어폭스에는 영구 설치되지
않습니다. 임시로 로드합니다: `about:debugging` → **This Firefox** → **Load Temporary Add-on** →
릴리즈의 `headerlab-<version>-firefox.zip` 을 그대로, 또는 `pnpm build` 뒤의
`.output/firefox-mv3/manifest.json`. 파이어폭스를 재시작하면 사라집니다. 에이전트 브리지는
파이어폭스에서 제공되지 않습니다 — 제한 사항 표를 보세요.
```

(e) `pnpm store:assets` 줄 아래:

```
pnpm amo:submit      # 파이어폭스 빌드를 zip 하고 Firefox Add-ons 에 제출 (자격 증명은 1Password 에서)
pnpm amo:probe       # Firefox Add-ons 리스팅 상태를 읽기만 — 아무것도 올리지 않음
```

- [ ] **Step 4: `docs/README.ja.md`**

(a) `Chrome はストアから、Firefox は Firefox Add-ons のリスティングが審査中の間はリリースページから。Safari は対応予定。`

(b) リリースページ:

```markdown
`extension-v*` リリースにはそれぞれ三つのアーカイブが添付されています: `headerlab-<version>-chrome.zip`、
`headerlab-<version>-firefox.zip`、そして Mozilla のレビュアーが再ビルドするソースアーカイブ
`headerlab-<version>-sources.zip` — 彼らが受け取ったものを誰でも見られるよう、一緒に添付します。
[リリースページ](https://github.com/say8425/headerlab/releases)から必要なバージョンの
Chrome アセットを取得して展開し、`chrome://extensions` → **デベロッパーモード** →
**パッケージ化されていない拡張機能を読み込む** → 展開したディレクトリ。
```

(c) 自分でビルドする — コードブロックはそのまま、下の文を:

```markdown
Node 24 — `.nvmrc` が固定しており、CI と Mozilla のレビュアーがビルドするバージョンです。
`pnpm build:firefox` は Firefox ターゲットだけをビルドし、その出力は Firefox Add-ons 上のパッケージと
バイト単位で同一です。`.output/chrome-mv3` を同じ手順で読み込みます。
```

(d) Firefox:

```markdown
Firefox Add-ons のリスティングは審査中です。公開されるまで、リリース版 Firefox には永続インストール
できません。一時的に読み込みます: `about:debugging` → **This Firefox** → **Load Temporary Add-on** →
リリースの `headerlab-<version>-firefox.zip` をそのまま、または `pnpm build` 後の
`.output/firefox-mv3/manifest.json`。Firefox を再起動すると消えます。エージェントブリッジは
Firefox では提供されません — 制限事項の表を参照。
```

(e) `pnpm store:assets` の下:

```
pnpm amo:submit      # Firefox ビルドを zip し、Firefox Add-ons に提出（認証情報は 1Password から）
pnpm amo:probe       # Firefox Add-ons のリスティング状態を読むだけ — 何もアップロードしない
```

- [ ] **Step 5: `docs/README.zh.md`**

(a) `Chrome 从商店安装，Firefox 在 Firefox Add-ons 列表审核期间从发布页面安装。Safari 在计划中。`

(b) 发布页面:

```markdown
每个 `extension-v*` 发布都附带三个压缩包：`headerlab-<version>-chrome.zip`、
`headerlab-<version>-firefox.zip`，以及 Mozilla 审核者用来重新构建的源码包
`headerlab-<version>-sources.zip` — 一并附上，让任何人都能看到他们拿到的是什么。在
[发布页面](https://github.com/say8425/headerlab/releases)取下你要的版本的 Chrome 资源，解压，然后
`chrome://extensions` → **开发者模式** → **加载已解压的扩展程序** → 选择解压后的目录。
```

(c) 自行构建 — 代码块不变，下面的句子改为:

```markdown
Node 24 — `.nvmrc` 固定了它，也是 CI 和 Mozilla 审核者构建时用的版本。`pnpm build:firefox` 只构建
Firefox 目标，其输出与 Firefox Add-ons 上的包逐字节相同。用同样的方式加载 `.output/chrome-mv3`。
```

(d) Firefox:

```markdown
Firefox Add-ons 列表正在审核中；上线之前，正式版 Firefox 不会永久安装它。临时加载：`about:debugging`
→ **This Firefox** → **Load Temporary Add-on** → 直接选发布页的 `headerlab-<version>-firefox.zip`，
或者 `pnpm build` 之后的 `.output/firefox-mv3/manifest.json`。Firefox 重启后即消失。代理桥接不在
Firefox 上提供 — 见限制表。
```

(e) `pnpm store:assets` 下面:

```
pnpm amo:submit      # 打包 Firefox 构建并提交到 Firefox Add-ons（凭据来自 1Password）
pnpm amo:probe       # 只读取 Firefox Add-ons 列表的状态 — 不上传任何东西
```

- [ ] **Step 6: `docs/README.es.md`**

(a) `Chrome desde la tienda, Firefox desde la página de releases mientras el listado en Firefox Add-ons está en revisión. Safari está previsto.`

(b) Página de releases:

```markdown
Cada release `extension-v*` adjunta tres archivos: `headerlab-<version>-chrome.zip`,
`headerlab-<version>-firefox.zip` y `headerlab-<version>-sources.zip` — el archivo de
fuentes que los revisores de Mozilla reconstruyen, adjunto para que cualquiera vea
exactamente lo que recibieron. Descarga el asset de Chrome de la versión que quieras desde
la [página de releases](https://github.com/say8425/headerlab/releases) y descomprímelo.
Luego `chrome://extensions` → **Modo de desarrollador** → **Cargar descomprimida** → el
directorio descomprimido.
```

(c) Constrúyelo tú mismo — el bloque de código queda igual; la frase de debajo pasa a ser:

```markdown
Node 24 — `.nvmrc` lo fija, y es la versión con la que construyen CI y los revisores de
Mozilla. `pnpm build:firefox` construye solo el objetivo de Firefox; su salida es, byte a
byte, el paquete de Firefox Add-ons. Carga `.output/chrome-mv3` de la misma forma.
```

(d) Firefox:

```markdown
El listado en Firefox Add-ons está en revisión; hasta que esté publicado, el Firefox de
release no la instalará de forma permanente. Cárgala temporalmente: `about:debugging` →
**This Firefox** → **Load Temporary Add-on** → el `headerlab-<version>-firefox.zip` de la
release tal cual, o `.output/firefox-mv3/manifest.json` tras `pnpm build`. Dura hasta que
Firefox se reinicie. El puente para agentes no se ofrece en Firefox — ver Limitaciones.
```

(e) Bajo `pnpm store:assets`:

```
pnpm amo:submit      # empaqueta la build de Firefox y la envía a Firefox Add-ons (credenciales desde 1Password)
pnpm amo:probe       # lee el estado del listado en Firefox Add-ons — no sube nada
```

- [ ] **Step 7: 다섯 판이 같은 명령을 말하는지, 팝업 리터럴이 그대로인지**

Run: `pnpm test 2>&1 | grep -E "readmeLiterals|storeListing|Test Files|Tests " ; pnpm test:packages 2>&1 | tail -5`
Expected: 둘 다 초록. 그리고 손으로: `grep -c "amo:submit" README.md docs/README.*.md` 가 다섯 파일 모두 `1`.

- [ ] **Step 8: 커밋**

```bash
git add PRIVACY.md README.md docs/README.ko.md docs/README.ja.md docs/README.zh.md docs/README.es.md
git commit -F - <<'EOF'
docs: the privacy policy names both browsers, and Install says what is true today

PRIVACY.md is one document for both stores now: the browser's storage and
engine rather than Chrome's, both build outputs in the grep, about:addons
beside chrome://extensions, and the bridge marked Chrome only with the
reason. The five READMEs describe the three release archives, the Firefox
zip as a temporary-load route, Node 24 for whoever rebuilds the sources
archive, and the two AMO commands — and nothing about a listing that does
not exist yet; that diff waits in docs/store/amo/checklist.md.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X7XpCj1bESKpE1VkojMAis
EOF
```

---

### Task 6: `CLAUDE.md` — 숫자를 재고, AMO 절을 더한다

**Files:**
- Modify: `CLAUDE.md` (Commands, Release, 새 "Firefox Add-ons (AMO)" 절, Known gaps, Toolchain 의 `@/…` 개수)

**Interfaces:**
- Consumes: Task 2 리포트의 sources zip 실측 (파일 수·바이트, `docs/**` 제외 뒤), Task 3 의 파일명, Task 4 의 `docs/store/amo/`.

이 파일의 규칙: **모든 숫자는 다시 잰다.** 아래에 `<…>` 로 적힌 값은 Task 2 리포트에서 옮기고, 그 밖의 수치는 이 과제 안에서 명령을 돌려 확인한다.

- [ ] **Step 1: Commands 블록**

`pnpm zip             # builds, then → .output/headerlab-<version>-chrome.zip` 를 다음 세 줄로:

```
pnpm zip             # both builds, then → .output/headerlab-<version>-{chrome,firefox,sources}.zip
pnpm amo:submit      # wxt zip -b firefox && node scripts/amo-submit.mjs — credentials from 1Password
pnpm amo:probe       # node scripts/amo-probe.mjs — reads the AMO listing's state, uploads nothing
```

- [ ] **Step 2: 개명된 파일명 세 곳**

`grep -n "store-submit.yml" CLAUDE.md` 가 찍는 세 줄의 `store-submit.yml` 을 `cws-submit.yml` 로. 문장은 그대로 참이다.

- [ ] **Step 3: Release 절 — 첫 문단과 새 문단 하나**

첫 문단의 "builds `pnpm zip` and attaches `.output/headerlab-<version>-chrome.zip` to the release." 를 이것으로:

```markdown
builds `pnpm zip` and attaches its three archives — `headerlab-<version>-chrome.zip`,
`-firefox.zip`, and `-sources.zip`, the archive Mozilla's reviewers rebuild — to the
release, then calls the two store workflows side by side.
```

"**There is a Chrome Web Store step now** (2026-08-26) …" 문단 (세 불릿 포함) **바로 뒤**에 새 문단:

```markdown
**There is a Firefox Add-ons step beside it (2026-09-10), and it is exactly the
`wxt submit` step the Chrome one is not.** `amo-submit.yml` is the second reusable
workflow the release run calls, gated by its own `firefox-amo` environment (secrets
`FIREFOX_JWT_ISSUER` and `FIREFOX_JWT_SECRET`, variable `FIREFOX_CHANNEL`), and it types
the one command a person types: `node scripts/amo-submit.mjs --channel <c> --expect-version
<v>`. That script checks the release's Firefox zip is the version being submitted, runs
`wxt submit` with the sources archive attached, and on `unlisted` waits for AMO's signature
and attaches `headerlab-<v>-firefox.xpi`. Three things about it are load-bearing:

- **A green run means AMO validated the upload and created the version.** On `listed`,
  approval is Mozilla's and arrives by email; on `unlisted` the signed file is on the
  release. Neither is "published" in the Chrome sense, and nothing waits for a verdict.
- **`wxt submit` cannot create the add-on, and AMO refuses a version it already holds.**
  So the first submission is a person's (`docs/store/amo/checklist.md` §3), and the order
  matters: it goes in *before* the release PR that follows this change is merged, with the
  archives `main` builds — otherwise that release's AMO job goes red on a 404 (designed:
  there is no add-on) and the automated path's first run slips a whole version.
- **The channel lives in the environment, not in the code.** `FIREFOX_CHANNEL` on
  `firefox-amo`, `listed` when unset, overridden by a `workflow_dispatch` input. Unlisted
  installs do not auto-update — no `update_url`, by decision — which is the same bargain
  the Chrome "release page" route makes.

The Chrome job now names `*-chrome.zip` in both places it used to glob `*.zip`; with three
archives, `unzip` and `pack-crx.mjs` would each have taken the second and third as member
patterns, silently. `tests/unit/storeSubmit.test.ts` pins that, both environment names,
that each credential is read only in the workflow declaring its environment, and that
the id the script submits under is the id the Firefox build carries.
```

- [ ] **Step 4: 새 절 "## Firefox Add-ons (AMO)"**

"## Chrome Web Store" 절의 끝 (그 절의 마지막 문단은 "**The packer reads the bytes back …**" 로 시작한다) 과 "## Platform traps that have already cost time" 사이에 넣는다:

```markdown
## Firefox Add-ons (AMO)

**Not listed yet.** The add-on `headerlab@say8425.github.io` did not exist on AMO as of
2026-09-10 — `GET /api/v5/addons/addon/headerlab@say8425.github.io/` answers 404 both
anonymously and with the developer's JWT, and the slug `headerlab` is free (404 too). The
account is real and has never submitted: the profile endpoint answers 200 with
`is_addon_developer: false` and `num_addons_listed: 0`. The runbook for the one
submission a person makes is `docs/store/amo/checklist.md`; everything after it is
`amo-submit.yml`, described under Release.

**`wxt submit` is `publish-browser-extension` under an alias, and that settles the
dependency question.** `node_modules/wxt/dist/cli/commands.mjs:77` registers `submit` as
an alias of that package's `publish-extension` CLI, and the package (5.1.0) is a
dependency of wxt itself — measured in `node_modules/.pnpm`. So a `wxt submit` step adds
nothing to `package.json`, and the rule stands. Its Firefox flow is four calls
(`dist/init-B7pE83dc.mjs:1590-1641`): GET the add-on, POST the upload with the channel,
poll the upload until `processed` (5 s apart, ten minutes at most — `pollUntil`,
`:1442`), POST the version with the sources archive as `source`. **Two things it does not
do** are why `scripts/amo-submit.mjs` exists around it: it cannot create an add-on (the
first call 404s and it stops), and it never fetches the signed file — on `unlisted` that
is the script's own poll on the version-detail endpoint, reading `file.status` through
`readSignedFile` in `scripts/lib/amo.mjs`, fail-closed on any status the API does not
document (`public`, `unreviewed`, `disabled`). `--dry-run` stops after the first call:
it proves the credentials and the add-on's existence and uploads nothing. It reads
`.env.submit` if one exists; `wxt submit init` writes secrets there, so `.gitignore`
carries it.

**The credential is a JWT the script mints per request.** AMO wants `Authorization: JWT
<token>`, HS256 over `{ iss, jti, iat, exp }`, and `exp` "must be no longer than five
minutes past the issued at time" — `claimSet` refuses a longer life, because the
alternative is a 401 with nothing in it. The key pair is the 1Password item **Firefox AMO
Token** (Personal vault, created 2026-09-09): its `username` field is the issuer
(`user:<id>:<key>`) and its `password` field the secret. `amo-submit.mjs` and
`amo-probe.mjs` read them with `op read` when `FIREFOX_JWT_ISSUER`/`FIREFOX_JWT_SECRET`
are not in the environment, and neither value is ever an argument or a log line. **Treat
the issuer as a secret too**; it is half of the pair. **One thing is unmeasured:**
`file.url` sits outside `/api/`, and whether the JWT header is honoured on that path is
inferred from `web-ext sign` doing the same. The first unlisted run measures it.

**The sources archive is required, and its shape was measured rather than assumed.** AMO
asks for the source of anything bundled, and a reviewer rebuilds it and diffs: "There
must be no differences." `wxt zip -b firefox` writes it by default (sources are on for
Firefox and Opera, `resolve-config.mjs:200`), dropping node_modules, the test files,
`.output/` and every dotfile. Measured 2026-09-09 on 1.7.0: **214 files, 2,767,184
bytes**, of which `docs/` was 67 files and 1.2 MB of store PNGs with no build input
among them — so `wxt.config.ts` excludes `docs/**`, and the archive is now
**<files> files, <bytes> bytes** (re-run `unzip -Z1 .output/headerlab-<v>-sources.zip |
wc -l`). `tests/` and `packages/` stay: the former is twelve small files once the tests
are gone, the latter is named by `pnpm-workspace.yaml` and a frozen install without it is
the prediction this file records getting wrong twice. **`.nvmrc` is not in the archive**
— it is a dotfile — which is why the five READMEs' "Build it yourself" say Node 24 in
words, and why `docs/store/amo/reviewer-notes.md` does too. The release attaches the
archive beside the two zips so what Mozilla reviewed is what anyone can download, and
`amo-submit.yml` takes it from there rather than rebuilding it.

**What the listing takes, from the store's own pages.** Summary ≤ 250 characters (the
manifest's 119 pre-fills it; `manifest.test.ts`'s 132 cap is the smaller one). Up to two
categories; slug `web-development`. Licence slug `Apache-2.0`. Screenshots at 1280×800,
"the maximum image display size" — exactly what `docs/store/assets/` holds, so the five
Chrome captures are reused (owner's call, 2026-09-10) at the cost that each shows the
agent bridge row the Firefox popup does not render; `docs/store/amo/listing.md` says what
the captions leave out. **The privacy policy is pasted as text, not linked** — the same
`PRIVACY.md`, rewritten on 2026-09-10 to name both browsers. The data-collection
declaration needs no form: it renders from the manifest's
`data_collection_permissions: none`.

**The reproduction check was declined (owner's call, 2026-09-10).** A job that unzips the
sources archive, installs and builds, and hashes the result against the Firefox zip
would run the reviewer's own check before the tag, at about a minute per push to `main`.
It is not there. What that buys is a minute; what it costs is that a reviewer's diff —
days after the tag — is the first measurement of "no differences". The day a rejection
names one, add the check; until then Known gaps records it.
```

- [ ] **Step 5: Known gaps 세 곳**

(a) "**Five hand-written declaration files exist**" 항목: `Five` → `Six`, 목록의 "plus `scripts/lib/png.d.mts` and `scripts/lib/crx.d.mts`" → "plus `scripts/lib/png.d.mts`, `scripts/lib/crx.d.mts`, `scripts/lib/cws.d.mts` and `scripts/lib/amo.d.mts`". 그리고 `find . -name '*.d.mts' -not -path './node_modules/*'` 를 돌려 여섯인지 센다 — 아니면 그 수를 적는다 (`cws.d.mts` 는 이 항목이 "three" 라고 하던 때 이미 빠져 있었을 수 있다; 명령이 답이다).

(b) 항목 둘을 끝에 더한다:

```markdown
- **Nothing checks that the sources archive rebuilds the Firefox package.** Owner's call,
  2026-09-10 (Firefox Add-ons section). Mozilla's reviewer performs that check after the
  tag; a rejection naming a difference is the signal to add a pre-tag job that unzips,
  installs, builds and hashes.
- **The Firefox Add-ons screenshots are the Chrome popup.** All five show the agent
  bridge row, which the Firefox popup does not render. Reused on the owner's instruction;
  `tests/support/firefox.ts`'s `screenshot()` is the tool for the Firefox set when it is
  wanted.
```

- [ ] **Step 6: Toolchain 의 `@/…` import 개수**

Run: `grep -rhoE "from '@/" components entrypoints lib tests | wc -l`
Expected: 224 (Task 1 의 `amo.test.ts` 와 Task 3 의 `storeSubmit.test.ts` 가 하나씩 더했다). 값이 다르면 그 값을 쓴다. "across 222 `@/…` imports (126 when this was written, then 141, then 189 — which was already 197 by the time the Firefox branch started and 222 when it landed; …" 를 "across <N> `@/…` imports (126 when this was written, then 141, then 189 — which was already 197 by the time the Firefox branch started, 222 when it landed and <N> with the AMO branch; …" 로.

- [ ] **Step 7: 확인**

Run: `grep -n "store-submit" CLAUDE.md; grep -c "amo-submit.yml" CLAUDE.md; pnpm exec vitest run tests/unit/storeSubmit.test.ts tests/unit/amo.test.ts`
Expected: 첫 grep 은 빈 출력, 둘째는 3 이상, 테스트 초록 (CLAUDE.md 는 어떤 테스트도 읽지 않는다 — 문장이 코드와 맞는지는 이 과제의 리뷰어가 본다).

- [ ] **Step 8: 커밋**

```bash
git add CLAUDE.md
git commit -F - <<'EOF'
docs: record the Firefox Add-ons path in CLAUDE.md, every number re-measured

Commands, the release section's second store job, and a new section for what
was measured on AMO: the add-on's absence, the alias wxt submit is, the four
calls it makes and the two it cannot, the JWT's five-minute cap, the sources
archive's shape before and after excluding docs/, what the listing takes, and
the reproduction check the owner declined.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X7XpCj1bESKpE1VkojMAis
EOF
```

---

### Task 7: `firefox-amo` 환경, 그리고 브랜치 전체 검증

**Files:** 저장소 밖 (GitHub 환경·시크릿·변수). 코드 변경 없음.

**Interfaces:**
- Consumes: 1Password `Firefox AMO Token` (`username`, `password`), Task 3 의 이름들.
- Produces: `amo-submit.yml` 이 처음 돌 때 읽을 환경. **이 PR 이 머지되기 전에** 있어야 한다 (스펙 §14).

- [ ] **Step 1: 환경과 브랜치 규칙**

```bash
gh api -X PUT repos/say8425/headerlab/environments/firefox-amo \
  -F can_admins_bypass=false \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/say8425/headerlab/environments/firefox-amo/deployment-branch-policies \
  -f name=main -f type=branch
gh api repos/say8425/headerlab/environments/firefox-amo \
  --jq '{name, can_admins_bypass, deployment_branch_policy}'
gh api repos/say8425/headerlab/environments/firefox-amo/deployment-branch-policies \
  --jq '.branch_policies[] | {name, type}'
```

Expected: `can_admins_bypass: false`, `custom_branch_policies: true`, 정책 `main`/`branch` 하나 — `chrome-web-store` 와 같은 모양. **`can_admins_bypass` 가 `true` 로 남으면** API 가 그 키를 받지 않은 것이다: 리포트에 적고, 오너가 Settings → Environments → firefox-amo 에서 "Allow administrators to bypass configured protection rules" 를 끄도록 남긴다. 추측으로 다른 엔드포인트를 두드리지 않는다.

- [ ] **Step 2: 시크릿 둘, 변수 하나 — 값은 파이프로만**

```bash
op read 'op://Personal/Firefox AMO Token/username' | gh secret set FIREFOX_JWT_ISSUER --env firefox-amo
op read 'op://Personal/Firefox AMO Token/password' | gh secret set FIREFOX_JWT_SECRET --env firefox-amo
gh variable set FIREFOX_CHANNEL --env firefox-amo --body listed
gh secret list --env firefox-amo
gh variable list --env firefox-amo
```

Expected: 시크릿 목록에 두 이름과 갱신 시각, 변수 목록에 `FIREFOX_CHANNEL  listed`. 값은 어디에도 찍히지 않는다 — `gh secret list` 는 이름만 보여준다.

- [ ] **Step 3: 브랜치 전체 검증**

```bash
pnpm check:all
pnpm test:e2e
git status --short
```

Expected: `check:all` 전부 초록 (단위 테스트는 1048 + amo.test 21 + storeSubmit 의 순증 + storeListing 의 5 = 리포트에 실제 수를 적는다), e2e `21 passed`, `git status` 는 비어 있다 (`.output/` 의 xpi·zip 은 ignored).

- [ ] **Step 4: 리포트에 적을 것**

환경 조회의 JSON, 시크릿·변수 이름 목록, `check:all` 과 `test:e2e` 의 마지막 요약 줄. 커밋할 것은 없다.

---

## 컨트롤러가 하는 마무리 (과제 밖)

- 브랜치 푸시, PR 생성 (`gh pr create`), `superpowers:requesting-code-review`. UI 변경이 없으므로 스크린샷은 없다.
- PR 본문에 스펙 §14 의 순서를 그대로 적는다: **첫 수동 제출은 #82 를 머지하기 전에**, main 의 1.7.0 아카이브로. 그리고 `firefox-amo` 환경이 이미 있다는 것과 그 조회 결과.
- 릴리스 산술: 이 PR 은 `feat:` 로 확장 패키지만 건드린다 → #82 (`extension 1.8.0`) 가 흡수, #87 (`cli 0.4.0`) 은 그대로.

## 자기 검토 기록

- **스펙 커버리지:** §3 → Task 2·3; §4 → Task 3; §5 → Task 1·2; §6 → Task 4; §7·§8 → Task 5; §9 → Task 6; §10 → Task 1·3·4; §11 → Task 7 (환경) + Task 4 (첫 제출 런북); §12 의 결정은 각 과제의 주석과 문서에; §13 은 Task 4 의 체크리스트 "will not happen" 과 Task 6 의 Known gaps 에; §14 → PR 본문과 체크리스트 §3.
- **스펙에서 좁힌 것 하나:** `FIREFOX_EXTENSION_ID` 는 워크플로가 아니라 `scripts/lib/amo.mjs` 한 곳에 (Task 3 의 Ruling). 가드는 그 상수 대 빌드된 manifest.
- **자리 표시자:** Task 6 의 `<files>`/`<bytes>`/`<N>` 는 Task 2 리포트와 Step 6 의 명령이 채우는 측정값이다 — 플랜이 미리 적으면 그것이 거짓이 된다.
- **이름 일관성:** `archiveNames`·`readSignedFile`·`manifestMatches`·`GECKO_ID`·`CHANNELS` 는 Task 1 에서 정의, Task 2·3 이 같은 이름으로 쓴다. 워크플로 단계 이름 `Refuse to run without real AMO credentials` / `Take the archives from the release` / `Submit to Firefox Add-ons` / `Attach the signed package to the release` 는 Task 3 의 YAML 과 테스트가 같은 문자열을 쓴다. 환경 `firefox-amo`, 변수 `FIREFOX_CHANNEL` 은 Task 3·4·6·7 에서 동일.
