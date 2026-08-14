# Agent Bridge — 2차 계획: workspace · 호스트 · CLI · 릴리즈 · 플러그인

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1차 계획이 만든 순수 층 위에, 소유자가 요청한 패키징 축을 전부 세운다 — pnpm workspace, 네이티브 호스트, CLI, 확장과 CLI 의 독립 릴리즈, Claude Code · Codex 플러그인 둘, 그리고 README 모식도.

**Architecture:** 확장은 저장소 루트에 그대로 있고 `packages/` 아래에 셋이 붙는다. `cli` 와 `host` 는 의존성 0 개의 Node, `plugin` 은 매니페스트 둘이 `skills/` 트리 하나를 공유한다. 릴리즈는 release-please 매니페스트 모드로 확장과 CLI 를 따로 내고, 플러그인 버전은 `extra-files` 로 CLI 를 따라간다.

**Tech Stack:** Node 24 내장만 (`node:net`·`node:util`·`node:os`·`node:fs`), release-please 17.6.0, pnpm 11.20.0

## 설계 문서

`docs/superpowers/specs/2026-08-11-agent-bridge-design.md`. 스파이크(`docs/research/2026-08-11-native-messaging-spike.md`)가 §8.4 를 뒤집은 뒤의 판을 읽는다.

## 1차에서 확정되어 여기 그대로 들어오는 것

- **하트비트도 `alarms` 도 없다.** 열린 포트가 SW 를 살려둔다(실측). 재연결은 `onStartup`·`onInstalled` 라는 기존 배선에 얹고, `onDisconnect` 에 제한된 재시도만 더한다.
- **어댑터는 `browser` 가 아니라 `chrome.runtime.connectNative` 를 부른다.** WXT 래퍼에 그 함수가 없다(실측).
- **호스트의 인터프리터 경로는 절대 경로여야 한다.** Chrome 이 주는 환경에 셸 PATH 가 없어 `env` 셔뱅은 첫 줄도 못 돈다(실측).
- **Chrome 이 호스트에 주는 argv 는 확장 origin 하나뿐이다.** 같은 프로필에서 두 번 연결해도 argv 가 동일한 호스트가 둘 생긴다(실측). 소켓 경로를 Chrome 이 주는 값에서 유도할 수 없다.

## Global Constraints

- **새 의존성 0개.** `node:util` 의 `parseArgs`, `node:net`, `node:os`, `node:fs` 만 쓴다.
- **`pnpm` 이 이 기계에서 깨져 있다.** corepack 이 프록시를 못 뚫는다. 래퍼를 PATH 앞에 두고 쓴다 — 디스패치가 정확한 명령을 준다. `pnpm install` 은 돌리지 않는다.
- **`pnpm test` 를 쓴다. 맨손 `vitest run` 금지.**
- **커밋·PR 은 영어**, `<type>: <description>`. **`docs/` 문서는 한국어. `lib/`·`packages/` 의 주석은 영어** — 1차에서 정해진 규칙이다.
- **불변성**: 새 객체를 반환한다.
- **모든 단언에 대해 묻는다: 어떤 잘못된 구현이 이걸 통과하는가?** 이 저장소는 "실패할 수 없는 단언"과 "없는 단언"을 반복 결함으로 이름 붙였고, 1차에서 여덟 개가 나왔다.
- oxlint 의 `require-to-throw-message` 가 켜져 있다 — 맨 `toThrow()` 는 린트 실패. 클래스 인자는 통과한다(1차에서 측정).
- **중첩 `.oxlintrc.json`·`.oxfmtrc.json` 을 만들지 않는다.** 측정됨: 중첩 설정은 루트를 확장하지 않고 **대체**하며, 루트의 `plugins` 배열까지 무효화한다.

## 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `pnpm-workspace.yaml` | `packages:` 키 추가. 기존 주석과 `allowBuilds` 는 손대지 않는다 | 1 |
| `packages/host/package.json`·`bin/headerlab-host.mjs` | stdio ↔ 유닉스 소켓 중계 | 2 |
| `packages/host/lib/framing.mjs` | 32비트 네이티브 바이트 오더 프레이밍. 순수 | 2 |
| `packages/host/lib/socket.mjs` | 소켓 경로·권한·레지스트리. 순수 부분과 fs 부분 분리 | 3 |
| `packages/cli/package.json`·`bin/headerlab.mjs` | 명령 표면, JSON 출력 | 4 |
| `packages/cli/lib/args.mjs` | `parseArgs` 래핑. 순수 | 4 |
| `packages/plugin/.claude-plugin/plugin.json` | Claude Code 매니페스트 | 6 |
| `packages/plugin/.codex-plugin/plugin.json` | Codex 매니페스트 | 6 |
| `packages/plugin/skills/headerlab/SKILL.md` | 매니페스트 둘이 공유 | 6 |
| `release-please-config.json`·`.release-please-manifest.json` | 매니페스트 모드 | 5 |
| `tests/unit/workspace.test.ts` | 워크스페이스·릴리즈 설정 가드 | 1·5 |
| `tests/unit/outbound.test.ts` | `packages/` 의 바깥 네트워크 금지 가드 | 2 |
| `README.md` | §1 모식도와 CLI 사용 예시 | 7 |

---

### Task 1: workspace 골격과 그 가드

**Files:**
- Modify: `pnpm-workspace.yaml`, `package.json`
- Create: `packages/cli/package.json`, `packages/host/package.json`, `packages/plugin/package.json`
- Test: `tests/unit/workspace.test.ts` (신규)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/workspace.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Everything `pnpm-workspace.yaml` declares must actually be there. */
function declaredPackages(): string[] {
  const yaml = readFileSync('pnpm-workspace.yaml', 'utf8');
  // `(?![\s\S])` rather than `\Z`: JS has no `\Z` anchor and parses it as
  // the literal character. With the block at the end of the file that
  // lookahead can never be satisfied, so the regex returned null against a
  // correct file — an assertion that could not pass rather than one that
  // could not fail.
  const block = /^packages:\s*$([\s\S]*?)(?=^\S|(?![\s\S]))/m.exec(yaml);
  if (!block) throw new Error('pnpm-workspace.yaml declares no `packages:` key');
  return [...block[1]!.matchAll(/^\s*-\s*(.+?)\s*$/gm)].map((m) => m[1]!);
}

describe('the workspace', () => {
  it('declares the three packages', () => {
    expect(declaredPackages()).toEqual(['packages/cli', 'packages/host', 'packages/plugin']);
  });

  // A glob would let a directory be added without anyone noticing it joined
  // the release surface. Naming them is what makes that a diff.
  it('names them rather than globbing', () => {
    expect(declaredPackages().some((p) => p.includes('*'))).toBe(false);
  });

  it.each(['packages/cli', 'packages/host', 'packages/plugin'])(
    '%s exists and has a package.json',
    (dir) => {
      expect(existsSync(`${dir}/package.json`)).toBe(true);
    },
  );

  // Measured: `allowBuilds` is pnpm 11's spelling and pnpm 10 ignores it in
  // silence. Adding `packages:` must not disturb the answer already recorded
  // for spawn-sync, which is what keeps `pnpm install` from failing.
  it('keeps the build answer that lets installs succeed', () => {
    expect(readFileSync('pnpm-workspace.yaml', 'utf8')).toContain('spawn-sync: false');
  });

  // Measured: a root script that re-runs `pnpm -r` with the workspace root
  // included runs every child script TWICE. The e2e echo server binds
  // loopback, so that is a port collision rather than merely a doubled bill.
  it('never fans out with the workspace root included', () => {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<
      string,
      string
    >;
    for (const [name, body] of Object.entries(scripts)) {
      expect(body, `${name} must not pass --include-workspace-root`).not.toContain(
        '--include-workspace-root',
      );
    }
  });

  // CLAUDE.md, measured: without `wxt prepare` oxlint resolves no `@/…` alias
  // and exits 0 having checked nothing across 141 imports. A root `lint` that
  // skips it reads as passing and is not.
  it('keeps wxt prepare in front of lint and typecheck', () => {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<
      string,
      string
    >;
    expect(scripts.lint).toContain('wxt prepare');
    expect(scripts.typecheck).toContain('wxt prepare');
  });
});
```

- [ ] **Step 2: 실패를 확인한다** — `packages:` 키가 없어 첫 테스트가 throw 한다.

- [ ] **Step 3: `pnpm-workspace.yaml` 에 append 한다**

기존 주석과 `allowBuilds` 를 **한 글자도 건드리지 않고** 파일 끝에 붙인다:

```yaml

# The extension itself stays at the repository root, and that is load-bearing
# rather than tidy: release-please prefixes every output with the package path
# once that path is not `.`, which would leave five conditions in
# release-please.yml evaluating false — tagging a release with no check, no
# zip and no attached artifact, in the one job holding contents: write, with
# nothing going red. See the design document §6.1.
#
# Named, not globbed. A glob lets a directory join the release surface without
# appearing in a diff.
packages:
  - packages/cli
  - packages/host
  - packages/plugin
```

- [ ] **Step 4: 세 패키지의 `package.json` 을 만든다**

`packages/cli/package.json` — 발행 여부는 아직 미결이므로 `private: true` 로 시작한다(설계 §6.5):

```json
{
  "name": "@headerlab/cli",
  "version": "0.0.0",
  "private": true,
  "description": "Drive the HeaderLab extension from a terminal.",
  "license": "Apache-2.0",
  "type": "module",
  "bin": { "headerlab": "bin/headerlab.mjs" },
  "files": ["bin", "lib"],
  "scripts": { "test": "node --test" }
}
```

`packages/host/package.json` 은 같은 모양에 `"name": "@headerlab/host"`, `"description": "Native messaging host bridging the HeaderLab extension to a local socket."`, `bin` 없이 `"files": ["bin", "lib"]`.

`packages/plugin/package.json` 은 `"name": "@headerlab/plugin"`, `"description": "HeaderLab skill for Claude Code and Codex."`, `"files": [".claude-plugin", ".codex-plugin", "skills", "bin"]`, `scripts` 없음.

- [ ] **Step 5: 루트 스크립트에 팬아웃을 더한다**

`package.json` 의 `scripts` 에 더한다. 기존 스크립트는 확장의 것이므로 **바꾸지 않는다**:

```json
    "test:packages": "pnpm -r test",
    "check:all": "pnpm check && pnpm -r test"
```

- [ ] **Step 6: 전체 검사** — `pnpm check` 초록. 그리고 `pnpm -r test` 가 세 패키지를 스코프에 잡는지 확인한다(`packages/plugin` 은 `test` 스크립트가 없어 건너뛰어진다).

- [ ] **Step 7: 커밋**

```
chore: open a pnpm workspace beside the extension

The extension stays at the repository root. release-please prefixes its
outputs with the package path the moment that path is not `.`, and the five
conditions in release-please.yml read the unprefixed names — so moving it
would tag releases with no check, no zip and no artifact, in the only job
holding contents: write, with nothing going red.

Packages are named rather than globbed so joining the release surface is a
diff someone reviews.
```

---

### Task 2: 네이티브 호스트 — 프레이밍

호스트를 두 조각으로 나눈다. 프레이밍은 순수하고 Node 에서 전부 테스트되며, 소켓은 Task 3 이다.

**Files:**
- Create: `packages/host/lib/framing.mjs`, `packages/host/test/framing.test.mjs`
- Create: `tests/unit/outbound.test.ts`

- [ ] **Step 1: 프레이밍 테스트를 쓴다**

`packages/host/test/framing.test.mjs` — Node 내장 테스트 러너를 쓴다(새 의존성 0):

```js
import assert from 'node:assert/strict';
import { endianness } from 'node:os';
import { test } from 'node:test';
import { decode, encode } from '../lib/framing.mjs';

test('encode writes a four byte header then the utf-8 body', () => {
  const frame = encode({ hello: 'world' });
  const body = JSON.stringify({ hello: 'world' });
  assert.equal(frame.length, 4 + Buffer.byteLength(body, 'utf8'));
  assert.equal(frame.subarray(4).toString('utf8'), body);
});

test('the length header counts BYTES, not characters', () => {
  // A multi-byte body is the case a naive `body.length` gets wrong, and it
  // gets it wrong in the direction that truncates.
  const frame = encode({ 값: '한글' });
  const declared =
    endianness() === 'LE' ? frame.readUInt32LE(0) : frame.readUInt32BE(0);
  assert.equal(declared, frame.length - 4);
  assert.ok(declared > JSON.stringify({ 값: '한글' }).length);
});

test('decode returns nothing until the whole body has arrived', () => {
  const frame = encode({ a: 1 });
  const { messages, rest } = decode(frame.subarray(0, frame.length - 1));
  assert.deepEqual(messages, []);
  assert.equal(rest.length, frame.length - 1);
});

test('decode reads two frames out of one chunk', () => {
  const chunk = Buffer.concat([encode({ a: 1 }), encode({ b: 2 })]);
  const { messages, rest } = decode(chunk);
  assert.deepEqual(messages, [{ a: 1 }, { b: 2 }]);
  assert.equal(rest.length, 0);
});

test('a frame survives the round trip', () => {
  const value = { cmd: 'site.add', domains: ['a.example.com'] };
  const { messages } = decode(encode(value));
  assert.deepEqual(messages, [value]);
});

// The protocol caps host→extension at 1 MB. Chrome drops the connection on a
// larger frame with no diagnosis, so the host refuses first and says so.
test('encode refuses a body over the protocol cap', () => {
  assert.throws(() => encode({ big: 'x'.repeat(1024 * 1024) }), /1 MB/);
});
```

- [ ] **Step 2: 실패를 확인한다.**

- [ ] **Step 3: `packages/host/lib/framing.mjs` 를 쓴다**

```js
import { endianness } from 'node:os';

/**
 * Chrome's native messaging framing: a 32-bit length in NATIVE byte order,
 * then a UTF-8 JSON body.
 *
 * The branch on `endianness()` is the whole point and it is also untestable
 * here in the way that matters: every platform Chrome supports is
 * little-endian, so a hardcoded writeUInt32LE would pass every assertion this
 * file could make. What the tests can hold is that the length counts BYTES
 * rather than characters, which is the mistake that actually happens.
 */
const LE = endianness() === 'LE';

/** host → extension, per the protocol. Larger frames are dropped by Chrome. */
export const MAX_OUTGOING = 1024 * 1024;

export function encode(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length > MAX_OUTGOING) {
    throw new Error(
      `frame is ${body.length} bytes and the protocol caps host messages at 1 MB; ` +
        'Chrome drops a larger one without saying why',
    );
  }
  const header = Buffer.alloc(4);
  if (LE) header.writeUInt32LE(body.length, 0);
  else header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * Reads whole frames out of a buffer, returning what it could not yet parse.
 * Never throws on a partial read — a chunk boundary is not an error.
 */
export function decode(buffer) {
  const messages = [];
  let rest = buffer;
  for (;;) {
    if (rest.length < 4) return { messages, rest };
    const length = LE ? rest.readUInt32LE(0) : rest.readUInt32BE(0);
    if (rest.length < 4 + length) return { messages, rest };
    messages.push(JSON.parse(rest.subarray(4, 4 + length).toString('utf8')));
    rest = rest.subarray(4 + length);
  }
}
```

- [ ] **Step 4: 바깥 네트워크 가드를 쓴다**

`tests/unit/outbound.test.ts`. 설계 §4.1: 번들 가드의 패턴을 재사용할 수 없다 — 유닉스 소켓은 `node:net` 이다.

```ts
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The extension bundle's guard bans every network primitive. This one cannot:
 * a unix socket IS `node:net`. So it bans the ones that leave the machine and
 * pins `net` to its path form.
 */
const FORBIDDEN = [
  /require\(['"]node:https?['"]\)|from\s+['"]node:https?['"]/,
  /from\s+['"]node:dgram['"]/,
  /\bfetch\s*\(/,
  /\bnew\s+WebSocket\b/,
  /\bnew\s+EventSource\b/,
  // `net.connect(port)` / `createServer().listen(port)` — the argument shape
  // that reaches the network rather than the filesystem.
  /\.(connect|listen)\s*\(\s*\d/,
];

const SOURCES = globSync('packages/{cli,host}/**/*.mjs');

describe('nothing under packages/ can leave this machine', () => {
  it('finds sources to check — an empty glob would pass vacuously', () => {
    expect(SOURCES.length).toBeGreaterThan(0);
  });

  it.each(SOURCES)('%s uses no outbound primitive', (path) => {
    const source = readFileSync(path, 'utf8');
    for (const pattern of FORBIDDEN) {
      expect(source, `${path} matched ${pattern}`).not.toMatch(pattern);
    }
  });

  // The guard has to be able to fail. These are the forms it must catch.
  it.each([
    `import https from 'node:https';`,
    `const r = await fetch('https://example.com');`,
    `const s = new WebSocket('wss://example.com');`,
    `server.listen(8080);`,
  ])('catches %s', (planted) => {
    expect(FORBIDDEN.some((p) => p.test(planted))).toBe(true);
  });

  // And it must not catch the unix socket forms this design is built on.
  it.each([`server.listen(socketPath);`, `net.connect(socketPath);`])(
    'permits %s',
    (benign) => {
      expect(FORBIDDEN.some((p) => p.test(benign))).toBe(false);
    },
  );
});
```

- [ ] **Step 5: 통과 확인, 전체 검사, 커밋**

```
feat: frame native messages in the host's own byte order

The length prefix counts bytes, not characters, and the tests hold that with
a multi-byte body — the mistake that actually happens, and the one that
truncates. The endianness branch itself is untestable here: every platform
Chrome supports is little-endian, so a hardcoded LE would pass anything this
file could assert, and saying so is better than a test that pretends.

The outbound guard cannot reuse the bundle's patterns because a unix socket
is node:net. It bans what leaves the machine and pins net to its path form,
with planted positives and negatives on both sides.
```

---

### Task 3: 네이티브 호스트 — 소켓과 수명

**Files:**
- Create: `packages/host/lib/socket.mjs`, `packages/host/bin/headerlab-host.mjs`, `packages/host/test/socket.test.mjs`

측정된 제약이 전부 여기 걸린다. 스파이크 문서를 먼저 읽는다.

- [ ] **Step 1: 순수 부분의 테스트를 쓴다**

`sun_path` 길이 검사와 레지스트리 항목 조립은 파일시스템 없이 테스트된다.

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SUN_PATH_MAX, assertSocketPathFits, socketPathFor } from '../lib/socket.mjs';

test('the sun_path limit is the measured 104, not a guess', () => {
  assert.equal(SUN_PATH_MAX, 104);
});

test('a path at the limit is accepted', () => {
  assertSocketPathFits('/'.padEnd(SUN_PATH_MAX, 'a'));
});

// EINVAL from bind() is opaque. Failing with the number is what makes it
// diagnosable three processes away.
test('a path over the limit fails with both numbers', () => {
  const tooLong = '/'.padEnd(SUN_PATH_MAX + 1, 'a');
  assert.throws(() => assertSocketPathFits(tooLong), (error) => {
    assert.match(error.message, new RegExp(String(SUN_PATH_MAX)));
    assert.match(error.message, new RegExp(String(tooLong.length)));
    return true;
  });
});

test('the socket path carries the pid, so two hosts never collide', () => {
  assert.notEqual(socketPathFor('/tmp/hl', 111), socketPathFor('/tmp/hl', 222));
  assert.match(socketPathFor('/tmp/hl', 111), /111/);
});
```

- [ ] **Step 2–3: 구현한다**

`packages/host/lib/socket.mjs` 가 지켜야 하는 것, 전부 실측에서 나왔다:

- **`SUN_PATH_MAX = 104`** — 104 는 성공, 105 는 `EINVAL`.
- **디렉터리는 `$TMPDIR`**, `/tmp` 가 아니다. `getconf DARWIN_USER_TEMP_DIR` 로 해석한다 — 호스트는 Chrome 의 환경을, CLI 는 터미널의 환경을 물려받으므로 `$TMPDIR` 환경변수가 어긋나면 둘이 다른 곳을 본다.
- **`listen()` 전에 umask 077**, 그리고 부모 디렉터리 0700. Node 는 소켓을 world-connectable 로 남긴다(측정: umask 022 아래 0755).
- **소켓 이름에 PID 접미사**, 같은 디렉터리에 `<pid>.json` 레지스트리(확장 origin, 시작 시각). 첫 호스트가 잘 알려진 이름을 차지하는 방식은 쓰지 않는다 — 두 번째가 무엇을 해야 할지가 다시 미결이 된다.
- **닫힌 stdin 이 종료 신호다.** SIGTERM 은 오지 않는다. 정리는 2초 한참 아래에 끝낸다.
- **시작 시 죽은 소켓을 unlink 한다**, 단 아무도 듣고 있지 않음을 확인한 뒤에.

`packages/host/bin/headerlab-host.mjs` 는 **절대 경로 셔뱅**을 갖는다. `#!/usr/bin/env node` 는 Chrome 이 주는 환경에서 첫 줄도 못 돈다(실측). 인스톨러가 설치 시점에 실제 node 경로를 써 넣는다.

- [ ] **Step 4–5: 전체 검사, 커밋**

---

### Task 4: CLI

**Files:**
- Create: `packages/cli/lib/args.mjs`, `packages/cli/bin/headerlab.mjs`, `packages/cli/test/args.test.mjs`

- [ ] **Step 1: 인자 파싱 테스트를 쓴다**

출력은 **항상 JSON 한 덩어리, stdout**. 에러도 `{"ok":false,"error":{…}}` 이고 exit code 가 따라붙는다.

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from '../lib/args.mjs';

test('reads a semantic command and its operands', () => {
  assert.deepEqual(parse(['site', 'add', 'a.example.com']), {
    ok: true,
    command: { cmd: 'site.add', domains: ['a.example.com'] },
  });
});

test('a command that would change nothing is refused, not accepted quietly', () => {
  const result = parse(['site', 'add']);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /at least one/);
});

test('names the command it does not know', () => {
  const result = parse(['teleport']);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /teleport/);
});

test('reads a rule add with its flags', () => {
  assert.deepEqual(
    parse(['rule', 'add', '--target', 'response', '--op', 'set', '--name', 'X', '--value', '1']),
    {
      ok: true,
      command: { cmd: 'rule.add', target: 'response', operation: 'set', name: 'X', value: '1' },
    },
  );
});

test('an empty argv asks for help rather than failing obscurely', () => {
  const result = parse([]);
  assert.equal(result.ok, false);
  assert.match(result.error.code, /usage/);
});
```

- [ ] **Step 2–5:** 구현, 전체 검사, 커밋. `bin/headerlab.mjs` 는 `parse()` 의 결과를 소켓으로 보내고 응답을 그대로 stdout 에 찍는다. 소켓이 없으면 `{"ok":false,"error":{"code":"bridge-off"}}` 와 non-zero exit — **재시도 루프가 아니라 상태**다(설계 §1).

---

### Task 5: 릴리즈 — 매니페스트 모드와 그 가드

**Files:**
- Create: `release-please-config.json`, `.release-please-manifest.json`
- Modify: `.github/workflows/release-please.yml`, `tests/unit/workspace.test.ts`

- [ ] **Step 1: 가드를 먼저 쓴다.** 런타임 검증이 없으므로 이게 유일한 기계적 방어다(설계 §6.4).

```ts
describe('the release configuration', () => {
  const config = JSON.parse(readFileSync('release-please-config.json', 'utf8'));
  const manifest = JSON.parse(readFileSync('.release-please-manifest.json', 'utf8'));

  // Nothing validates this file at runtime. extractReleaserConfig reads a
  // fixed list of known keys and discards the rest without a log line, so a
  // per-package typo is invisible in the editor AND at runtime — the plugin
  // version would silently stop tracking and the first symptom is a report.
  it('configures exactly the packages that exist', () => {
    expect(Object.keys(config.packages)).toEqual(['.', 'packages/cli']);
    for (const path of Object.keys(config.packages)) {
      expect(existsSync(path === '.' ? 'package.json' : `${path}/package.json`)).toBe(true);
    }
  });

  // include-component-in-tag defaults to TRUE in manifest mode — the opposite
  // of the action input's default. Exactly one package may hold the bare
  // v<version> namespace, and v1.0.0 already belongs to the extension.
  it('leaves the bare tag namespace to the extension', () => {
    expect(config.packages['.']['include-component-in-tag']).toBe(false);
    expect(config.packages['packages/cli']['include-component-in-tag']).toBeUndefined();
  });

  // A never-released package must be seeded exactly "0.0.0" or the backfill
  // makes its first changelog cover the entire history.
  it('seeds the unreleased package at exactly 0.0.0', () => {
    expect(manifest['.']).toBe('1.0.0');
    expect(manifest['packages/cli']).toBe('0.0.0');
  });

  // All eleven extraFileUpdates sites set createIfMissing: false. A wrong
  // path produces no error and no diff — the version just stops tracking.
  it('points extra-files at manifests that exist', () => {
    for (const entry of config.packages['packages/cli']['extra-files']) {
      const path = typeof entry === 'string' ? entry : entry.path;
      expect(existsSync(path.replace(/^\//, ''))).toBe(true);
    }
  });

  // The workflow reads unprefixed outputs, which only exist while the
  // extension sits at `.`.
  it('keeps the workflow reading output names its packages can produce', () => {
    const workflow = readFileSync('.github/workflows/release-please.yml', 'utf8');
    expect(workflow).toContain('steps.release.outputs.release_created');
    expect(workflow).not.toContain('release-type: node');
  });
});
```

- [ ] **Step 2–3: 설정을 쓴다**

`release-please-config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/v17.6.0/schemas/config.json",
  "separate-pull-requests": true,
  "packages": {
    ".": { "release-type": "node", "include-component-in-tag": false },
    "packages/cli": {
      "release-type": "node",
      "component": "cli",
      "extra-files": [
        "/packages/plugin/.claude-plugin/plugin.json",
        "/packages/plugin/.codex-plugin/plugin.json"
      ]
    }
  }
}
```

`.release-please-manifest.json`: `{ ".": "1.0.0", "packages/cli": "0.0.0" }`

워크플로 수정은 **`release-type: node` 한 줄 삭제**가 전부다. `config-file` 과 `manifest-file` 은 선택 입력이고, `releaseType` 이 있으면 매니페스트 모드에 도달하지 않는다.

- [ ] **Step 4–5: 전체 검사, 커밋**

---

### Task 6: 플러그인 둘, 스킬 하나

**Files:**
- Create: `packages/plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `packages/plugin/.codex-plugin/plugin.json`, `packages/plugin/skills/headerlab/SKILL.md`, `packages/plugin/bin/headerlab`
- Test: `tests/unit/plugin.test.ts`

- [ ] **Step 1: 가드를 쓴다**

```ts
describe('the plugin manifests', () => {
  const claude = JSON.parse(readFileSync('packages/plugin/.claude-plugin/plugin.json', 'utf8'));
  const codex = JSON.parse(readFileSync('packages/plugin/.codex-plugin/plugin.json', 'utf8'));

  // Both are rewritten by the CLI's release through extra-files. If they ever
  // disagree, one of the two paths stopped being written and nothing said so.
  it('carries one version across both manifests', () => {
    expect(claude.version).toBe(codex.version);
  });

  it('uses strict semver, which is what Codex validates', () => {
    expect(claude.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  // Verified against the validator shipped inside the codex binary: name,
  // version, description, author (object with name) and interface with seven
  // fields are all required, and `hooks` is rejected outright.
  it('gives Codex every field its validator requires', () => {
    expect(codex.author?.name).toBeTruthy();
    expect(Object.keys(codex.interface ?? {}).sort()).toEqual(
      [
        'capabilities',
        'category',
        'defaultPrompt',
        'developerName',
        'displayName',
        'longDescription',
        'shortDescription',
      ].sort(),
    );
    expect(codex).not.toHaveProperty('hooks');
  });

  // Measured: a marketplace entry carrying its own version creates a drift
  // class, and disagreement makes install exit 1. One number, one file.
  it('keeps the version out of the marketplace entry', () => {
    const market = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'));
    expect(market.plugins[0]).not.toHaveProperty('version');
  });

  // No declarative preflight exists, so the skill must run one. Prose asking
  // the model to notice a missing binary is a silent failure by this repo's
  // own definition.
  it('makes the skill check for its CLI before its content is read', () => {
    const skill = readFileSync('packages/plugin/skills/headerlab/SKILL.md', 'utf8');
    expect(skill).toContain('command -v headerlab');
  });
});
```

- [ ] **Step 2–5:** 매니페스트 둘, `marketplace.json`(버전 없이), `SKILL.md`(frontmatter 는 `name`+`description` — 양쪽이 공유하는 필수 부분집합), `bin/headerlab` 심. 전체 검사, 커밋.

---

### Task 7: README

**Files:** `README.md`

- [ ] 설계 §1 의 모식도와 CLI 사용 예시를 넣는다. 소유자가 명시적으로 요청했다.
- [ ] **아직 존재하지 않는 것을 있는 것처럼 쓰지 않는다.** 어댑터(`port.ts`)와 팝업 행은 이 계획에도 없다 — README 는 지금 도는 것만 주장한다.
- [ ] Tailwind 비용을 잰다: `README.md` 는 `.md` 라 스캔되지 않지만(측정됨), 확인은 한 번 한다.

---

## 이 계획에 없는 것

- **`lib/bridge/port.ts` 어댑터와 팝업의 브리지 행.** 확장 쪽 변경이라 축이 다르다. 3차.
- **스냅샷과 되돌리기.** 어댑터와 같은 축.
- **CLI 의 npm 발행.** 레지스트리 결정이 따로 필요하다(설계 §6.5).
