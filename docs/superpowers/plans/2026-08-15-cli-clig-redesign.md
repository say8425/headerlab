# CLI clig.dev Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `headerlab` 을 clig.dev 에 맞춘다 — 도움말·사람용 출력·stderr·종료 코드 다섯·읽기 명령 넷·측정된 결함 여섯의 수정.

**Architecture:** 표현을 순수 모듈로 분리하고(`commands`/`help`/`suggest`/`render`/`exit`) TTY·env·스트림을 아는 어댑터를 하나(`output.mjs`)만 둔다. 확장 쪽은 `commandSchema` 옆에 `querySchema` 를 더해 읽기를 나르되 리듀서(`apply()`)는 건드리지 않는다. `bin/headerlab.mjs` 는 배선만 남는다.

**Tech Stack:** Node ≥20 (`node:util` `parseArgs`, `node:test`), 런타임 의존성 0. 확장 쪽은 TypeScript + zod + vitest.

**Spec:** `docs/superpowers/specs/2026-08-15-cli-clig-redesign-design.md` — 이 계획은 스펙에서 논증을 가져오므로 둘을 같이 읽는다.

## Global Constraints

- **의존성을 절대 추가하지 않는다.** `package.json` 의 `dependencies` 는 없고 그대로 없어야 한다. CLI 프레임워크·색 라이브러리·Levenshtein 패키지 전부 금지. `node:util` 의 `parseArgs` 가 파서다.
- **pnpm 이고 버전이 고정되어 있다.** `npm` 이 아니라 `pnpm`. 패키지 테스트는 저장소 루트에서 `pnpm test:packages`, 개별 파일은 `packages/headerlab` 에서 `node --test test/<파일>`.
- **확장 테스트는 `pnpm test`** (= `wxt build && vitest run`). 맨 `vitest run` 은 금지 — 여러 테스트가 *빌드된* 산출물을 검사한다.
- **기계용 JSON 봉투의 구조는 바뀌지 않는다.** `{ok, error?, state?, changed?, note?}`, 필드 이름, 성공 응답의 전체 상태 전부 그대로. 유일한 예외는 Task 3 의 코드 개명 한 건.
- **`headerlab status` 는 브릿지가 없어도 exit 0.** 종료 코드 표의 유일한 예외.
- **커밋과 PR 은 영어.** `<type>: <description>`. 타입: feat, fix, refactor, docs, test, chore, perf, ci.
- **모든 assertion 마다 "이걸 통과시키는 잘못된 구현은 무엇인가" 를 묻는다.** `toContain`/부분 일치 대신 정확한 값. 부재를 존재보다 먼저 검사.
- **변이 검증은 커밋 후에** — 커밋 전 `git checkout --` 되돌리기가 이 저장소에서 실제 편집을 날린 적이 있다.
- 브랜치 `cli-clig-redesign`, 기준 커밋 `8665df1`.

## 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `packages/headerlab/lib/commands.mjs` | 명령표 (순수 데이터). 도움말·파서 메시지·오타 제안의 단일 출처 | 1 |
| `packages/headerlab/lib/exit.mjs` | `error.code` → 종료 코드 | 3 |
| `packages/headerlab/lib/suggest.mjs` | Levenshtein 오타 제안 | 4 |
| `packages/headerlab/lib/help.mjs` | 표 → 도움말 문자열 | 4 |
| `packages/headerlab/lib/render.mjs` | payload + `{color}` → 사람용 문자열 | 5 · 15 |
| `packages/headerlab/lib/output.mjs` | 유일한 어댑터 — TTY·env·스트림·종료 | 6 |
| `packages/headerlab/lib/args.mjs` | 파싱. 표를 읽고 전역 플래그를 먼저 걷는다 | 2 · 9 · 10 · 15 |
| `packages/headerlab/lib/bridge.mjs` | 소켓. 전역 플래그 추출, 진행 표시 훅 | 2 · 12 |
| `packages/headerlab/lib/install.mjs` | `dryRun` 지원 | 11 |
| `packages/headerlab/bin/headerlab.mjs` | 배선만 | 7 · 8 · 9 · 15 |
| `lib/bridge/protocol.ts` | `querySchema` 추가 | 13 |
| `lib/bridge/query.ts` | 순수: `AppState` → `StatusPayload` | 13 |
| `lib/bridge/port.ts` | query 분기 | 14 |

---

### Task 1: 명령표

**Files:**
- Create: `packages/headerlab/lib/commands.mjs`
- Create: `packages/headerlab/test/commands.test.mjs`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `COMMANDS: Command[]`, `findCommand(argv: string[]): Command | null`, `commandPaths(): string[]`, `GROUPS: string[]`.
  `Command` 는 `{ path: string[], summary: string, args?: string, flags?: {name: string, arg?: string, summary: string}[], examples?: string[] }`.
  `path` 는 `['site','add']` 처럼 명령을 이루는 토큰들. `pause` 처럼 그룹 없는 것은 `['pause']`.

이 태스크는 **동작을 바꾸지 않는다.** 표만 만들고, 표와 파서가 서로를 덮는지 검사한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/headerlab/test/commands.test.mjs`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMANDS, GROUPS, commandPaths, findCommand } from '../lib/commands.mjs';

// 지금 파서가 아는 아홉 가지. lib/args.mjs 의 switch 와
// lib/bridge/protocol.ts 의 commandSchema 에서 손으로 옮긴 것이며,
// 아래 두 테스트가 이 목록과 표를 양방향으로 묶는다.
const PARSER_KNOWS = [
  'site add',
  'site rm',
  'site all-sites',
  'rule add',
  'rule rm',
  'rule toggle',
  'pause',
  'resume',
  'state set',
  'bridge install',
  'bridge uninstall',
  'bridge status',
];

test('표가 파서가 아는 모든 명령을 담는다', () => {
  assert.deepEqual(commandPaths().sort(), [...PARSER_KNOWS].sort());
});

test('표에 파서가 모르는 명령이 없다', () => {
  // 위 deepEqual 이 이미 양방향이지만, 실패했을 때 어느 쪽이 남는지
  // 읽히도록 차집합을 따로 낸다.
  const extra = commandPaths().filter((p) => !PARSER_KNOWS.includes(p));
  assert.deepEqual(extra, []);
});

test('findCommand 가 가장 긴 일치를 고른다', () => {
  assert.deepEqual(findCommand(['site', 'add', 'example.com']).path, ['site', 'add']);
  assert.deepEqual(findCommand(['pause']).path, ['pause']);
});

test('findCommand 는 모르는 것에 null 을 준다', () => {
  assert.equal(findCommand(['sight', 'add']), null);
  assert.equal(findCommand([]), null);
});

test('모든 항목이 한 줄 요약을 갖는다', () => {
  const missing = COMMANDS.filter((c) => typeof c.summary !== 'string' || c.summary.length === 0);
  assert.deepEqual(missing, []);
});

test('GROUPS 가 실제 그룹 이름들이다', () => {
  assert.deepEqual([...GROUPS].sort(), ['bridge', 'pause', 'resume', 'rule', 'site', 'state']);
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd packages/headerlab && node --test test/commands.test.mjs
```
Expected: FAIL — `Cannot find module '../lib/commands.mjs'`

- [ ] **Step 3: 표를 만든다**

`packages/headerlab/lib/commands.mjs`:

```js
/**
 * 이 CLI 의 명령표. 순수 데이터이며, 네 가지가 전부 여기서 파생된다:
 * `--help`/`-h` 의 최상위 도움말, `help <cmd>` 의 명령별 도움말,
 * `lib/args.mjs` 가 내는 에러 메시지의 usage 줄, 오타 제안의 후보 집합.
 *
 * 도움말을 손으로 따로 쓰면 파서와 어긋나고, 어긋난 것을 아무것도 잡지
 * 않는다 — 이 저장소가 한 술어를 네 번 구현하고 갈라뜨려 치른 비용과
 * 같은 모양이다. `test/commands.test.mjs` 가 표와 파서를 양방향으로 묶는다.
 */

export const COMMANDS = [
  {
    path: ['site', 'add'],
    args: '<domain>...',
    summary: 'scope the rules to one or more sites',
    examples: ['headerlab site add example.com', 'headerlab site add a.example.com b.example.com'],
  },
  {
    path: ['site', 'rm'],
    args: '<domain>...',
    summary: 'remove sites from the scope',
    examples: ['headerlab site rm example.com'],
  },
  {
    path: ['site', 'all-sites'],
    args: 'on|off',
    summary: 'turn the applies-everywhere mode on or off',
    examples: ['headerlab site all-sites on'],
  },
  {
    path: ['rule', 'add'],
    summary: 'add one header rule',
    flags: [
      { name: '--target', arg: 'request|response', summary: 'which direction to modify' },
      { name: '--op', arg: 'set|append|remove', summary: 'what to do with the header' },
      { name: '--name', arg: '<header>', summary: 'the header name (default: empty)' },
      { name: '--value', arg: '<value>', summary: 'the header value (default: empty)' },
    ],
    examples: ['headerlab rule add --target request --op set --name X-Debug --value 1'],
  },
  {
    path: ['rule', 'rm'],
    args: '<id>',
    summary: 'remove a rule by id',
    examples: ['headerlab rule rm 3f9a'],
  },
  {
    path: ['rule', 'toggle'],
    args: '<id>',
    summary: 'turn a rule on or off, or flip it',
    flags: [
      { name: '--on', summary: 'turn it on' },
      { name: '--off', summary: 'turn it off' },
    ],
    examples: ['headerlab rule toggle 3f9a', 'headerlab rule toggle 3f9a --off'],
  },
  {
    path: ['pause'],
    summary: 'stop modifying headers, without changing any rule',
    examples: ['headerlab pause'],
  },
  { path: ['resume'], summary: 'resume after a pause', examples: ['headerlab resume'] },
  {
    path: ['state', 'set'],
    args: '<file|->',
    summary: 'replace the entire stored state',
    examples: ['headerlab state set state.json'],
  },
  {
    path: ['bridge', 'install'],
    summary: 'install the native-messaging host manifest',
    flags: [
      { name: '--extension-id', arg: '<id>', summary: 'the id from chrome://extensions' },
      { name: '--load-path', arg: '<dir>', summary: 'compute the id from an unpacked directory' },
      { name: '--user-data-dir', arg: '<dir>', summary: 'a non-default Chrome profile directory' },
      { name: '--browser', arg: 'chrome|chromium', summary: 'which browser (default: chrome)' },
    ],
    examples: ['headerlab bridge install --extension-id abcdefghijklmnopabcdefghijklmnop'],
  },
  {
    path: ['bridge', 'uninstall'],
    summary: 'remove the manifest this installed',
    flags: [
      { name: '--user-data-dir', arg: '<dir>', summary: 'a non-default Chrome profile directory' },
      { name: '--browser', arg: 'chrome|chromium', summary: 'which browser (default: chrome)' },
    ],
    examples: ['headerlab bridge uninstall'],
  },
  {
    path: ['bridge', 'status'],
    summary: 'report what is installed at one location',
    flags: [
      { name: '--user-data-dir', arg: '<dir>', summary: 'a non-default Chrome profile directory' },
      { name: '--browser', arg: 'chrome|chromium', summary: 'which browser (default: chrome)' },
    ],
    examples: ['headerlab bridge status', 'headerlab bridge status --browser chromium'],
  },
];

export const GROUPS = [...new Set(COMMANDS.map((c) => c.path[0]))];

/** `['site','add']` → `'site add'`. 표를 문자열로 다루는 모든 곳이 이 한 줄을 쓴다. */
export const pathKey = (path) => path.join(' ');

export function commandPaths() {
  return COMMANDS.map((c) => pathKey(c.path));
}

/**
 * argv 앞머리에서 가장 긴 일치를 고른다. `site all-sites on` 이
 * `site` 가 아니라 `site all-sites` 로 잡혀야 하므로 길이 내림차순이다.
 */
export function findCommand(argv) {
  const sorted = [...COMMANDS].sort((a, b) => b.path.length - a.path.length);
  for (const command of sorted) {
    if (command.path.every((token, i) => argv[i] === token)) return command;
  }
  return null;
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
cd packages/headerlab && node --test test/commands.test.mjs
```
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add packages/headerlab/lib/commands.mjs packages/headerlab/test/commands.test.mjs
git commit -m "feat: add the command table the help and parser will share"
```

---

### Task 2: 전역 플래그를 먼저 걷고, `site` 가 플래그를 거부한다

측정된 결함: `headerlab site add example.com --json` 이 **exit 0** 으로 성공하며 `--json` 을 도메인으로 저장한다. 이 계획이 `--json` 을 전역 플래그로 만들기 전에 고쳐야 한다.

**Files:**
- Modify: `packages/headerlab/lib/bridge.mjs` (`extractBridgeFlag` → `extractGlobals`)
- Modify: `packages/headerlab/lib/args.mjs` (`parseSite`)
- Modify: `packages/headerlab/bin/headerlab.mjs` (호출부)
- Modify: `packages/headerlab/test/bridge.test.mjs`, `packages/headerlab/test/args.test.mjs`

**Interfaces:**
- Consumes: 없음
- Produces: `extractGlobals(argv: string[]): { globals: Globals, rest: string[] }` — 던지지 않고, 문제를 `globals.error` 로 돌려준다.
  `Globals` = `{ bridgePid: number|null, json: boolean, quiet: boolean, noColor: boolean, noInput: boolean, force: boolean, help: boolean, version: boolean, error: string|null }`.
  Task 6·7·9 가 이 모양에 의존한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/headerlab/test/bridge.test.mjs` 끝에 덧붙인다:

```js
import { extractGlobals } from '../lib/bridge.mjs';

test('extractGlobals 가 전역 플래그를 걷고 나머지를 남긴다', () => {
  assert.deepEqual(extractGlobals(['site', 'add', 'a.com', '--json']), {
    globals: {
      bridgePid: null,
      json: true,
      quiet: false,
      noColor: false,
      noInput: false,
      force: false,
      help: false,
      version: false,
      error: null,
    },
    rest: ['site', 'add', 'a.com'],
  });
});

test('extractGlobals 가 --bridge 의 pid 를 걷는다', () => {
  const { globals, rest } = extractGlobals(['--bridge', '42', 'pause']);
  assert.equal(globals.bridgePid, 42);
  assert.deepEqual(rest, ['pause']);
});

test('extractGlobals 는 던지지 않고 error 로 답한다', () => {
  assert.equal(extractGlobals(['--bridge']).globals.error, '--bridge needs a pid');
  assert.equal(
    extractGlobals(['--bridge', 'x']).globals.error,
    '--bridge needs a numeric pid, got: x',
  );
});

test('extractGlobals 가 짧은 이름도 받는다', () => {
  assert.equal(extractGlobals(['-h']).globals.help, true);
  assert.equal(extractGlobals(['-q', 'pause']).globals.quiet, true);
  assert.equal(extractGlobals(['-f', 'pause']).globals.force, true);
});
```

`packages/headerlab/test/args.test.mjs` 끝에 덧붙인다:

```js
test('site add 는 플래그처럼 생긴 토큰을 도메인으로 저장하지 않는다', () => {
  assert.deepEqual(parse(['site', 'add', 'a.com', '--nope']), {
    ok: false,
    error: { code: 'invalid-args', message: "site add: Unknown option '--nope'" },
  });
});

test('site rm 도 같다', () => {
  assert.deepEqual(parse(['site', 'rm', '--nope']), {
    ok: false,
    error: { code: 'invalid-args', message: "site rm: Unknown option '--nope'" },
  });
});

test('site add 는 여전히 여러 도메인을 받는다', () => {
  assert.deepEqual(parse(['site', 'add', 'a.com', 'b.com']), {
    ok: true,
    command: { cmd: 'site.add', domains: ['a.com', 'b.com'] },
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd packages/headerlab && node --test test/bridge.test.mjs test/args.test.mjs
```
Expected: FAIL — `extractGlobals` 가 없고, `site add a.com --nope` 는 `{ok:true, domains:['a.com','--nope']}` 를 준다.

- [ ] **Step 3: 구현한다**

`lib/bridge.mjs` 의 `extractBridgeFlag` 를 지우고 그 자리에 넣는다:

```js
/**
 * 전역 플래그는 어느 한 명령의 문법이 아니라 CLI 전체의 것이므로 argv 어디에
 * 있어도 되고, `args.mjs` 의 `parse()` 가 보기 전에 걷힌다. `--bridge` 가
 * 원래 이렇게 동작했고, 나머지가 같은 취급을 받는다.
 *
 * 던지지 않는다. 이 함수가 던지면 `--help` 를 처리하기도 전에 죽는 경로가
 * 생기는데, 도움말은 문제가 있을 때 가장 필요한 것이다. 문제는 `error` 로
 * 실어 보내고 호출부가 도움말을 낼지 실패할지 정한다.
 */
const BOOLEAN_GLOBALS = new Map([
  ['--json', 'json'],
  ['--quiet', 'quiet'],
  ['-q', 'quiet'],
  ['--no-color', 'noColor'],
  ['--no-input', 'noInput'],
  ['--force', 'force'],
  ['-f', 'force'],
  ['--help', 'help'],
  ['-h', 'help'],
  ['--version', 'version'],
]);

export function extractGlobals(argv) {
  const globals = {
    bridgePid: null,
    json: false,
    quiet: false,
    noColor: false,
    noInput: false,
    force: false,
    help: false,
    version: false,
    error: null,
  };
  const rest = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const boolean = BOOLEAN_GLOBALS.get(token);
    if (boolean !== undefined) {
      globals[boolean] = true;
      continue;
    }
    if (token === '--bridge') {
      const value = argv[i + 1];
      i += 1;
      if (value === undefined) {
        globals.error ??= '--bridge needs a pid';
        continue;
      }
      const pid = Number(value);
      if (!Number.isInteger(pid) || pid <= 0) {
        globals.error ??= `--bridge needs a numeric pid, got: ${value}`;
        continue;
      }
      globals.bridgePid = pid;
      continue;
    }
    rest.push(token);
  }

  return { globals, rest };
}
```

`lib/args.mjs` 의 `parseSite` 를 바꾼다:

```js
function parseSite(args) {
  const [sub, ...rest] = args;
  if (sub === 'add' || sub === 'rm') {
    // `allowPositionals: true` 로 파싱하는 이유는 도메인을 받기 위해서가
    // 아니라 **플래그를 거부하기 위해서**다. 이전에는 남은 토큰을 전부
    // 도메인으로 삼았고, `site add a.com --json` 이 exit 0 으로 성공하며
    // `--json` 을 도메인으로 저장했다 — `effectiveDomain` 이 그대로 저장하고
    // `suppressionReason` 이 `unusable-site` 를 돌려주어 프로필 전체가
    // 컴파일을 멈춘다. 같은 CLI 의 `bridge status` 는 이미 이렇게 거부한다.
    let positionals;
    try {
      ({ positionals } = parseArgs({ args: rest, options: {}, allowPositionals: true }));
    } catch (error) {
      return invalidArgs(`site ${sub}: ${error.message}`);
    }
    if (positionals.length === 0) {
      return invalidArgs(`site ${sub} needs at least one domain`);
    }
    return ok({ cmd: sub === 'add' ? 'site.add' : 'site.remove', domains: positionals });
  }
  if (sub === 'all-sites') {
    const [state] = rest;
    if (state !== 'on' && state !== 'off') {
      return invalidArgs(`site all-sites needs "on" or "off", got: ${state ?? '(nothing)'}`);
    }
    return ok({ cmd: 'site.allSites', on: state === 'on' });
  }
  return invalidArgs(`unknown site command: ${sub ?? '(nothing)'}`);
}
```

`bin/headerlab.mjs` 의 `main()` 앞부분을 바꾼다 (전체 재배선은 Task 7 이 한다):

```js
  const { globals, rest } = extractGlobals(process.argv.slice(2));
  if (globals.error !== null) {
    fail('usage', globals.error);
    return;
  }
  const bridgePid = globals.bridgePid;
```

`import { extractBridgeFlag, … }` 를 `import { extractGlobals, … }` 로 고치고, 기존 `extractBridgeFlag` 를 쓰던 `try`/`catch` 블록을 지운다. `test/bridge.test.mjs` 의 기존 `extractBridgeFlag` 테스트도 함께 지운다 — 대체된 것이지 사라진 동작이 아니다.

- [ ] **Step 4: 통과를 확인한다**

```bash
cd packages/headerlab && node --test
```
Expected: PASS 전부

- [ ] **Step 5: 실제 결함이 사라졌는지 손으로 확인한다**

```bash
node bin/headerlab.mjs site add example.com --nope; echo "exit=$?"
```
Expected: `{"ok":false,"error":{"code":"invalid-args","message":"site add: Unknown option '--nope'"}}`, exit 1
(종료 코드 2 는 Task 3 이 준다.)

- [ ] **Step 6: 커밋**

```bash
git add packages/headerlab/lib/bridge.mjs packages/headerlab/lib/args.mjs \
        packages/headerlab/bin/headerlab.mjs packages/headerlab/test/
git commit -m "fix: refuse flags in site add instead of storing them as domains"
```

---

### Task 3: 종료 코드

**Files:**
- Create: `packages/headerlab/lib/exit.mjs`
- Create: `packages/headerlab/test/exit.test.mjs`
- Modify: `packages/headerlab/bin/headerlab.mjs` (`invalid-command` → `invalid-args` 개명, `fail()` 이 종료 코드를 쓴다)

**Interfaces:**
- Consumes: 없음
- Produces: `EXIT = {OK:0, FAILED:1, USAGE:2, NO_BRIDGE:3, TRANSPORT:4}`, `exitFor(code: string): number`, `ERROR_CODES: string[]` (알려진 전부).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/headerlab/test/exit.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ERROR_CODES, EXIT, exitFor } from '../lib/exit.mjs';

test('각 코드가 정해진 종료 코드로 간다', () => {
  assert.equal(exitFor('usage'), 2);
  assert.equal(exitFor('unknown-command'), 2);
  assert.equal(exitFor('invalid-args'), 2);
  assert.equal(exitFor('bridge-off'), 3);
  assert.equal(exitFor('multiple-bridges'), 3);
  assert.equal(exitFor('timeout'), 4);
  assert.equal(exitFor('bridge-error'), 4);
  assert.equal(exitFor('bridge-closed'), 4);
  assert.equal(exitFor('invalid-command'), 1);
  assert.equal(exitFor('store-unreadable'), 1);
  assert.equal(exitFor('unsupported'), 1);
  assert.equal(exitFor('install-failed'), 1);
});

test('모르는 코드는 1 이다', () => {
  assert.equal(exitFor('something-nobody-declared'), 1);
});

test('EXIT.OK 은 0 이고 다른 어떤 것도 0 이 아니다', () => {
  assert.equal(EXIT.OK, 0);
  const nonZero = Object.entries(EXIT).filter(([name]) => name !== 'OK');
  assert.deepEqual(
    nonZero.filter(([, value]) => value === 0),
    [],
  );
});

// 이 테스트가 이 파일의 존재 이유다. 코드를 새로 만들고 종료 코드를 안
// 정하는 것이 이 설계에서 가장 쉬운 퇴행이라, 소스에서 실제로 쓰이는
// 코드 문자열을 긁어 목록과 맞춘다.
test('소스가 내는 모든 코드가 ERROR_CODES 에 있다', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const files = [
    ...readdirSync(path.join(root, 'lib')).map((n) => path.join(root, 'lib', n)),
    ...readdirSync(path.join(root, 'bin')).map((n) => path.join(root, 'bin', n)),
  ].filter((p) => p.endsWith('.mjs'));

  const found = new Set();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/code:\s*'([a-z-]+)'/g)) found.add(match[1]);
    for (const match of source.matchAll(/withCode\([^,]+,\s*'([a-z-]+)'\)/g)) found.add(match[1]);
  }

  const unmapped = [...found].filter((code) => !ERROR_CODES.includes(code));
  assert.deepEqual(unmapped, []);
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd packages/headerlab && node --test test/exit.test.mjs
```
Expected: FAIL — `Cannot find module '../lib/exit.mjs'`

- [ ] **Step 3: 구현한다**

`packages/headerlab/lib/exit.mjs`:

```js
/**
 * `error.code` 를 종료 코드로 옮기는 유일한 곳.
 *
 * 이전에는 실패가 전부 1 이었고, 그래서 오타(`headerlab sight add`)와
 * "브릿지가 안 떠 있음"(`headerlab site add`)이 스크립트 입장에서 구분되지
 * 않았다 — 둘 다 exit 1, 둘 다 stdout. 이제 2 와 3 으로 갈린다.
 *
 * 갈래는 넷이고, 각각 호출자가 실제로 분기하는 지점이다:
 *   2  당신이 잘못 쳤다 — CLI 가 스스로 거부했고 아무 데도 가지 않았다
 *   3  브릿지에 닿지 못했다 — 팝업에서 Enable 을 누르라는 뜻
 *   4  연결은 됐으나 교환이 실패했다
 *   1  목적지가 요청을 거부했다
 */
export const EXIT = {
  OK: 0,
  FAILED: 1,
  USAGE: 2,
  NO_BRIDGE: 3,
  TRANSPORT: 4,
};

const BY_CODE = new Map([
  ['usage', EXIT.USAGE],
  ['unknown-command', EXIT.USAGE],
  ['invalid-args', EXIT.USAGE],
  ['bridge-off', EXIT.NO_BRIDGE],
  ['multiple-bridges', EXIT.NO_BRIDGE],
  ['timeout', EXIT.TRANSPORT],
  ['bridge-error', EXIT.TRANSPORT],
  ['bridge-closed', EXIT.TRANSPORT],
  // 아래는 전부 EXIT.FAILED — 목적지가 거부한 것들. 기본값과 같은 값이지만
  // 이름을 적어 두어야 test/exit.test.mjs 의 전수 검사가 의미를 갖는다.
  ['invalid-command', EXIT.FAILED],
  ['invalid-state', EXIT.FAILED],
  ['unknown-rule', EXIT.FAILED],
  ['unknown-domain', EXIT.FAILED],
  ['store-unreadable', EXIT.FAILED],
  ['store-unwritable', EXIT.FAILED],
  ['unsupported', EXIT.FAILED],
  ['install-failed', EXIT.FAILED],
]);

export const ERROR_CODES = [...BY_CODE.keys()];

export function exitFor(code) {
  return BY_CODE.get(code) ?? EXIT.FAILED;
}
```

- [ ] **Step 4: `invalid-command` 의 CLI 생산분을 개명한다**

`bin/headerlab.mjs` 의 `resolveStateCommand` 안에 세 군데 있는
`wrapped.code = 'invalid-command'` 를 전부 `wrapped.code = 'invalid-args'` 로
바꾸고, 그 위 docblock에 한 문단을 더한다:

```js
 * 이 세 실패는 `invalid-args` 다. `invalid-command` 였으나, 그 코드는
 * 확장의 `port.ts` 가 `parseCommand` 실패에 쓰는 것이기도 해서 한 코드에
 * 뜻이 둘이었다 — 하나는 "당신이 나쁜 파일을 가리켰다"(사용자 입력),
 * 다른 하나는 "확장이 명령 모양을 거부했다"(버전 어긋남). 종료 코드가
 * 달라야 하므로(2 대 1) 코드도 달라야 한다.
```

`resolveStateCommand` 의 `catch` 에 있는 `error.code ?? 'invalid-command'` 도
`error.code ?? 'invalid-args'` 로 바꾼다.

`fail()` 이 종료 코드를 쓰게 한다:

```js
import { EXIT, exitFor } from '../lib/exit.mjs';

function fail(code, message) {
  printResult({ ok: false, error: { code, message } });
  process.exitCode = exitFor(code);
}
```

그리고 소켓 응답의 실패도:

```js
    const result = await sendCommand(target.socketPath, command);
    printResult(result);
    if (result.ok === false) process.exitCode = exitFor(result.error?.code ?? 'bridge-error');
```

- [ ] **Step 5: 통과를 확인하고 손으로도 본다**

```bash
cd packages/headerlab && node --test
node bin/headerlab.mjs sight add x >/dev/null; echo "오타 exit=$?"
node bin/headerlab.mjs site add example.com >/dev/null; echo "브릿지없음 exit=$?"
```
Expected: 테스트 전부 PASS · `오타 exit=2` · `브릿지없음 exit=3`

- [ ] **Step 6: 커밋**

```bash
git add packages/headerlab/lib/exit.mjs packages/headerlab/test/exit.test.mjs \
        packages/headerlab/bin/headerlab.mjs
git commit -m "feat: map error codes to distinct exit codes"
```

---

### Task 4: 오타 제안과 도움말 텍스트

**Files:**
- Create: `packages/headerlab/lib/suggest.mjs`, `packages/headerlab/lib/help.mjs`
- Create: `packages/headerlab/test/suggest.test.mjs`, `packages/headerlab/test/help.test.mjs`

**Interfaces:**
- Consumes: Task 1 의 `COMMANDS`, `GROUPS`, `findCommand`, `pathKey`
- Produces: `suggest(input: string, candidates: string[]): string|null`;
  `topHelp(): string`, `commandHelp(entry: Command): string`, `usageLine(entry: Command): string`,
  `ISSUES_URL: string`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/headerlab/test/suggest.test.mjs`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { suggest } from '../lib/suggest.mjs';

const GROUPS = ['bridge', 'site', 'rule', 'pause', 'resume', 'state'];

test('한 글자 차이를 잡는다', () => {
  assert.equal(suggest('sight', GROUPS), 'site');
  assert.equal(suggest('rul', GROUPS), 'rule');
});

test('너무 먼 것은 제안하지 않는다', () => {
  assert.equal(suggest('completely-different', GROUPS), null);
});

// 거리 2 이하라도 후보가 짧으면 우연의 일치다. 'site' 와 'rule' 은
// 거리 4 로 안전하지만, 'on' 과 'off' 같은 짧은 쌍에서 이 규칙이 일한다.
test('짧은 후보에는 40% 규칙이 걸린다', () => {
  assert.equal(suggest('xn', ['on', 'off']), null);
});

test('빈 입력에는 아무것도 제안하지 않는다', () => {
  assert.equal(suggest('', GROUPS), null);
});

test('정확히 일치하면 제안하지 않는다 — 제안할 오타가 없다', () => {
  assert.equal(suggest('site', GROUPS), null);
});
```

`packages/headerlab/test/help.test.mjs`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMANDS, findCommand, pathKey } from '../lib/commands.mjs';
import { ISSUES_URL, commandHelp, topHelp, usageLine } from '../lib/help.mjs';
import { parse } from '../lib/args.mjs';

test('최상위 도움말이 모든 그룹을 이름으로 담는다', () => {
  const text = topHelp();
  const missing = ['status', 'site', 'rule', 'pause', 'resume', 'state', 'bridge'].filter(
    (group) => !text.includes(group),
  );
  assert.deepEqual(missing, []);
});

test('최상위 도움말이 제보 경로를 담는다', () => {
  assert.equal(topHelp().includes(ISSUES_URL), true);
  assert.equal(ISSUES_URL, 'https://github.com/say8425/headerlab/issues');
});

test('최상위 도움말이 예제를 먼저 놓는다', () => {
  const text = topHelp();
  assert.equal(text.indexOf('EXAMPLES') < text.indexOf('COMMANDS'), true);
});

// 도움말의 예제가 실제로 파싱되는지가 이 파일의 핵심이다. 예제가
// 문서로만 맞고 파서에서 틀리면, 그게 이 표를 만든 이유가 무너진 것이다.
test('표의 모든 예제가 실제로 파싱된다', () => {
  const broken = [];
  for (const command of COMMANDS) {
    for (const example of command.examples ?? []) {
      const argv = example.split(' ').slice(1); // 'headerlab' 을 뗀다
      const result = parse(argv);
      if (!result.ok) broken.push(`${example} → ${result.error.message}`);
    }
  }
  assert.deepEqual(broken, []);
});

test('명령별 도움말이 그 명령의 플래그를 전부 담는다', () => {
  const entry = findCommand(['rule', 'add']);
  const text = commandHelp(entry);
  const missing = entry.flags.filter((flag) => !text.includes(flag.name));
  assert.deepEqual(missing, []);
});

test('usageLine 이 인자와 플래그를 담는다', () => {
  assert.equal(usageLine(findCommand(['site', 'add'])), 'headerlab site add <domain>...');
  assert.equal(usageLine(findCommand(['pause'])), 'headerlab pause');
});

test('모든 항목에 도움말이 만들어진다 — 던지는 것이 없다', () => {
  for (const command of COMMANDS) {
    const text = commandHelp(command);
    assert.equal(typeof text, 'string');
    assert.equal(text.includes(pathKey(command.path)), true);
  }
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd packages/headerlab && node --test test/suggest.test.mjs test/help.test.mjs
```
Expected: FAIL — 두 모듈 다 없음

- [ ] **Step 3: `suggest.mjs` 를 만든다**

```js
/**
 * 오타 제안. clig.dev Help §10 — "사용자가 뭘 하려 했는지 짐작할 수 있으면
 * 고쳐서 제안하라."
 *
 * 손으로 짠 이유는 하나다: 이 패키지의 런타임 의존성은 0 이고, 그 0 이
 * 광고 문구이자 이 프로젝트가 존재하는 이유(숨은 트래커로 내려간 확장의
 * 대체재)와 직결된다. 20줄짜리 편집거리 하나를 위해 그걸 깨지 않는다.
 */

function distance(a, b) {
  // Wagner–Fischer. 한 줄만 들고 간다 — 후보가 열댓 개고 이름이 짧다.
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * 가장 가까운 후보 하나, 또는 null.
 *
 * 문턱이 둘인 이유: 절대 거리 2 만 쓰면 짧은 이름끼리 우연히 걸린다
 * (`on` 과 `off` 는 거리 2 다). 후보 길이의 40% 도 함께 넘어야 제안한다.
 * 정확히 일치하는 입력에는 제안하지 않는다 — 그건 오타가 아니다.
 */
export function suggest(input, candidates) {
  if (input.length === 0) return null;
  if (candidates.includes(input)) return null;

  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const d = distance(input, candidate);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  if (best === null) return null;
  if (bestDistance > 2) return null;
  if (bestDistance > Math.floor(best.length * 0.4)) return null;
  return best;
}
```

- [ ] **Step 4: `help.mjs` 를 만든다**

```js
import { COMMANDS, pathKey } from './commands.mjs';

/**
 * 표(`commands.mjs`)를 사람이 읽을 문자열로 옮긴다. 이 파일은 표를 읽기만
 * 하고 명령을 알지 못한다 — 명령이 하나 늘면 표에 한 줄이 늘 뿐 여기는
 * 그대로다.
 */

export const ISSUES_URL = 'https://github.com/say8425/headerlab/issues';

export function usageLine(entry) {
  const parts = ['headerlab', ...entry.path];
  if (entry.args) parts.push(entry.args);
  return parts.join(' ');
}

const pad = (text, width) => text.padEnd(width, ' ');

export function topHelp() {
  const examples = [
    ['headerlab status', 'what is set up right now'],
    ['headerlab site add example.com', 'scope the rules to a site'],
    ['headerlab rule add --target request --name X-Debug --value 1', ''],
    ['headerlab state get --json | jq .state', 'read the whole state'],
  ];

  // 그룹 단위로 접어서 보여준다. 열두 줄을 낱낱이 세우면 최상위 도움말이
  // 스크롤되고, clig Help §8 이 말하는 "흔한 것을 앞에" 가 무너진다.
  const groups = [
    ['status', '', 'what is installed, live, and configured'],
    ['site', 'add rm ls all-sites', 'which sites the rules apply to'],
    ['rule', 'add rm ls toggle', 'the header rules themselves'],
    ['pause | resume', '', 'stop and restart header modification'],
    ['state', 'get set', 'read or replace the whole stored state'],
    ['bridge', 'install uninstall status', 'the native-messaging host manifest'],
  ];

  const flags = [
    ['    --json', 'machine-readable output (the default when not a terminal)'],
    ['-q, --quiet', 'errors only'],
    ['    --no-color', 'disable colour (also honours NO_COLOR, TERM=dumb)'],
    ['-h, --help', "this help, or a command's help"],
    ['    --version', 'print the version'],
    ['    --bridge <pid>', 'pick a bridge when more than one is running'],
  ];

  return [
    "headerlab — drive the HeaderLab Chrome extension's header rules from a terminal",
    '',
    'USAGE',
    '  headerlab <command> [flags]',
    '',
    'EXAMPLES',
    ...examples.map(([cmd, note]) => (note ? `  ${pad(cmd, 42)}${note}` : `  ${cmd}`)),
    '',
    'COMMANDS',
    ...groups.map(([name, subs, note]) => `  ${pad(name, 9)}${pad(subs, 26)}${note}`),
    '',
    'FLAGS',
    ...flags.map(([name, note]) => `  ${pad(name, 18)}${note}`),
    '',
    'The CLI cannot turn the bridge on — a person must press Enable in the popup.',
    'Run `headerlab help bridge install` for why.',
    '',
    `Report a problem: ${ISSUES_URL}`,
  ].join('\n');
}

export function commandHelp(entry) {
  const lines = [`headerlab ${pathKey(entry.path)} — ${entry.summary}`, '', 'USAGE', `  ${usageLine(entry)}`];

  if (entry.flags?.length) {
    lines.push('', 'FLAGS');
    const width = Math.max(...entry.flags.map((f) => `${f.name} ${f.arg ?? ''}`.trim().length));
    for (const flag of entry.flags) {
      lines.push(`  ${pad(`${flag.name} ${flag.arg ?? ''}`.trim(), width + 2)}${flag.summary}`);
    }
  }

  if (entry.examples?.length) {
    lines.push('', 'EXAMPLES', ...entry.examples.map((e) => `  ${e}`));
  }

  lines.push('', `Report a problem: ${ISSUES_URL}`);
  return lines.join('\n');
}

/** `help` 로도 `--help` 로도 안 잡히는 이름에 붙일 후보 목록. */
export function allPaths() {
  return COMMANDS.map((c) => pathKey(c.path));
}
```

- [ ] **Step 5: 통과를 확인한다**

```bash
cd packages/headerlab && node --test test/suggest.test.mjs test/help.test.mjs
```
Expected: PASS

`'표의 모든 예제가 실제로 파싱된다'` 가 빨갛다면 표의 예제가 틀린 것이지
테스트가 틀린 것이 아니다 — `commands.mjs` 의 예제를 고친다.

- [ ] **Step 6: 커밋**

```bash
git add packages/headerlab/lib/suggest.mjs packages/headerlab/lib/help.mjs \
        packages/headerlab/test/suggest.test.mjs packages/headerlab/test/help.test.mjs
git commit -m "feat: build help text and typo suggestions from the command table"
```

---

### Task 5: 사람용 렌더

**Files:**
- Create: `packages/headerlab/lib/render.mjs`
- Create: `packages/headerlab/test/render.test.mjs`

**Interfaces:**
- Consumes: 없음 (순수)
- Produces: `renderResult(payload: object, opts: {command: string[], color: boolean}): string`,
  `renderError(error: {code, message}, opts: {color: boolean}): string`,
  `COLORS` (테스트가 이스케이프를 이름으로 부르기 위해).

`process` 를 읽지 않는다. 색 여부는 인자로 받는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/headerlab/test/render.test.mjs`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderError, renderResult } from '../lib/render.mjs';

const plain = { color: false };

test('site add 가 전체 상태가 아니라 요약을 그린다', () => {
  const payload = {
    ok: true,
    changed: true,
    state: {
      globalPause: false,
      profiles: [
        {
          id: 'p1',
          enabled: true,
          filter: { domains: ['a.com', 'b.com'], allSites: false },
          headers: [],
        },
      ],
    },
  };
  const text = renderResult(payload, { command: ['site', 'add'], ...plain });
  // 부재를 먼저 검사한다: AppState 를 통째로 찍는 구현이 이 파일의 결함이었다.
  assert.equal(text.includes('"profiles"'), false);
  assert.equal(text.includes('p1'), false);
  assert.equal(text, '2 sites in scope: a.com, b.com');
});

test('changed:false 는 아무것도 안 바뀌었다고 말한다', () => {
  const payload = {
    ok: true,
    changed: false,
    state: { globalPause: false, profiles: [{ id: 'p1', enabled: true, filter: { domains: ['a.com'], allSites: false }, headers: [] }] },
  };
  const text = renderResult(payload, { command: ['site', 'add'], ...plain });
  assert.equal(text, 'nothing changed — 1 site in scope: a.com');
});

test('all-sites 모드는 도메인 목록 대신 모드를 말한다', () => {
  const payload = {
    ok: true,
    changed: true,
    state: { globalPause: false, profiles: [{ id: 'p1', enabled: true, filter: { domains: ['a.com'], allSites: true }, headers: [] }] },
  };
  assert.equal(
    renderResult(payload, { command: ['site', 'all-sites'], ...plain }),
    'applying to all sites',
  );
});

test('bridge status 를 표로 그린다', () => {
  const payload = {
    ok: true,
    installed: true,
    manifestPath: '/m/com.headerlab.bridge.json',
    launcherPath: '/l/headerlab-host',
    launcherMissing: false,
    entryMissing: false,
    allowedOrigins: ['chrome-extension://abc/'],
    liveBridges: [],
  };
  assert.equal(
    renderResult(payload, { command: ['bridge', 'status'], ...plain }),
    [
      'manifest  installed      /m/com.headerlab.bridge.json',
      'launcher  ok             /l/headerlab-host',
      'bridge    not running',
    ].join('\n'),
  );
});

test('bridge status 가 entryMissing 을 그대로 말한다', () => {
  const payload = {
    ok: true,
    installed: true,
    manifestPath: '/m/x.json',
    launcherPath: '/l/headerlab-host',
    launcherMissing: false,
    entryMissing: true,
    allowedOrigins: [],
    liveBridges: [{ pid: 9, origin: null }],
  };
  const text = renderResult(payload, { command: ['bridge', 'status'], ...plain });
  assert.equal(text.includes('entry missing'), true);
  assert.equal(text.includes('1 live (pid 9)'), true);
});

test('에러는 메시지 한 줄이다', () => {
  assert.equal(
    renderError({ code: 'store-unreadable', message: 'the stored state does not match' }, plain),
    'the stored state does not match',
  );
});

test('bridge-off 는 다음에 칠 명령을 붙인다', () => {
  const text = renderError({ code: 'bridge-off', message: 'no bridge is running' }, plain);
  assert.equal(
    text,
    [
      'no bridge is running.',
      '  headerlab bridge status                        see what is installed',
      '  headerlab bridge install --extension-id <id>   if the manifest is missing',
      'Then open the HeaderLab popup and press Enable on the bridge row — the CLI',
      'cannot do that step.',
    ].join('\n'),
  );
});

test('색이 꺼지면 이스케이프가 한 바이트도 없다', () => {
  const payload = { ok: true, changed: true, state: { globalPause: false, profiles: [] } };
  const on = renderResult(payload, { command: ['pause'], color: true });
  const off = renderResult(payload, { command: ['pause'], color: false });
  assert.equal(/\[/.test(off), false);
  assert.equal(/\[/.test(on), true);
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd packages/headerlab && node --test test/render.test.mjs
```
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현한다**

`packages/headerlab/lib/render.mjs`:

```js
/**
 * payload 를 사람이 읽을 문자열로 옮긴다. **순수** — `process` 를 읽지
 * 않고, 색 여부는 인자로 받는다. 스트림·TTY·환경변수를 아는 것은
 * `lib/output.mjs` 하나뿐이며, 그 분리 덕분에 사람용 출력이 프로세스를
 * 띄우지 않고 테스트된다.
 *
 * 요약하되 전체를 찍지 않는다 (clig Output §5). 쓰기 응답은 AppState 를
 * 통째로 실어 오지만 — 기계용 봉투는 그 계약을 지킨다 — 사람에게 그것을
 * 보여줄 이유는 없었던 적이 없다.
 */

export const COLORS = {
  reset: '[0m',
  dim: '[2m',
  red: '[31m',
  green: '[32m',
  amber: '[33m',
};

const paint = (text, color, on) => (on ? `${color}${text}${COLORS.reset}` : text);
const pad = (text, width) => text.padEnd(width, ' ');

function activeProfile(state) {
  return state?.profiles?.[0] ?? null;
}

function scopeSummary(state) {
  const profile = activeProfile(state);
  if (profile === null) return 'nothing in scope';
  if (profile.filter.allSites) return 'applying to all sites';
  const domains = profile.filter.domains;
  if (domains.length === 0) return 'nothing in scope';
  const noun = domains.length === 1 ? 'site' : 'sites';
  return `${domains.length} ${noun} in scope: ${domains.join(', ')}`;
}

function renderWrite(payload, command) {
  const summary =
    command[0] === 'site'
      ? scopeSummary(payload.state)
      : command[0] === 'rule'
        ? ruleSummary(payload.state)
        : pauseSummary(payload.state);
  if (payload.changed === false) return `nothing changed — ${summary}`;
  return summary;
}

function ruleSummary(state) {
  const profile = activeProfile(state);
  const rules = profile?.headers ?? [];
  const on = rules.filter((rule) => rule.enabled).length;
  const noun = rules.length === 1 ? 'rule' : 'rules';
  return `${rules.length} ${noun}, ${on} on`;
}

function pauseSummary(state) {
  return state?.globalPause ? 'paused — no headers are being modified' : 'running';
}

function renderBridgeStatus(payload, color) {
  const manifest = payload.installed ? 'installed' : 'not installed';
  const launcher = payload.launcherMissing
    ? paint('missing', COLORS.red, color)
    : payload.entryMissing
      ? paint('entry missing', COLORS.amber, color)
      : paint('ok', COLORS.green, color);
  const live =
    payload.liveBridges.length === 0
      ? 'not running'
      : `${payload.liveBridges.length} live (${payload.liveBridges.map((b) => `pid ${b.pid}`).join(', ')})`;

  return [
    `manifest  ${pad(manifest, 15)}${paint(payload.manifestPath, COLORS.dim, color)}`,
    `launcher  ${pad(launcher, 15)}${paint(payload.launcherPath, COLORS.dim, color)}`,
    `bridge    ${live}`,
  ]
    .map((line) => line.trimEnd())
    .join('\n');
}

function renderBridgeInstall(payload, color) {
  const lines = [
    `installed  ${paint(payload.manifestPath, COLORS.dim, color)}`,
    `launcher   ${paint(payload.launcherPath, COLORS.dim, color)}`,
    `extension  ${payload.extensionId}`,
  ];
  if (payload.note) lines.push('', payload.note);
  return lines.join('\n');
}

export function renderResult(payload, { command, color }) {
  const key = command.join(' ');
  if (key === 'bridge status') return renderBridgeStatus(payload, color);
  if (key === 'bridge install') return renderBridgeInstall(payload, color);
  if (key === 'bridge uninstall') {
    return payload.removed?.length ? `removed ${payload.removed.join(', ')}` : 'nothing to remove';
  }
  return renderWrite(payload, command);
}

/**
 * `bridge-off` 만 여러 줄인 이유는 그것이 소켓을 쓰는 모든 명령이 착지하는
 * 가장 흔한 실패이면서, 그 다음에 칠 명령을 아무것도 알려주지 않았기
 * 때문이다 (clig Output §9). 기계용 봉투의 `error.message` 는 첫 문장
 * 그대로다 — 여러 줄 메시지는 파싱하는 쪽에 새 부담이다.
 */
export function renderError(error, { color }) {
  if (error.code === 'bridge-off') {
    return [
      paint('no bridge is running.', COLORS.red, color),
      `  ${pad('headerlab bridge status', 46)}see what is installed`,
      `  ${pad('headerlab bridge install --extension-id <id>', 46)}if the manifest is missing`,
      'Then open the HeaderLab popup and press Enable on the bridge row — the CLI',
      'cannot do that step.',
    ].join('\n');
  }
  return paint(error.message, COLORS.red, color);
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
cd packages/headerlab && node --test test/render.test.mjs
```
Expected: PASS (8 tests)

`bridge-off` 테스트가 공백 하나 때문에 실패하면 테스트의 기대 문자열이
정답이다 — `pad` 폭을 맞춘다.

- [ ] **Step 5: 커밋**

```bash
git add packages/headerlab/lib/render.mjs packages/headerlab/test/render.test.mjs
git commit -m "feat: render payloads for humans without touching process"
```

---

### Task 6: 출력 어댑터

**Files:**
- Create: `packages/headerlab/lib/output.mjs`
- Create: `packages/headerlab/test/output.test.mjs`

**Interfaces:**
- Consumes: Task 2 의 `Globals`
- Produces: `resolveMode(globals, streams): 'json'|'human'`,
  `resolveColor(globals, env, stream): boolean`.
  `streams` 는 `{stdout: {isTTY}, stderr: {isTTY}}` 모양이면 되고, `stream` 은 그중 하나.

두 함수 다 순수하다 — `process` 를 인자로 받는다. 실제 쓰기는 Task 7 이 `bin/` 에서 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/headerlab/test/output.test.mjs`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveColor, resolveMode } from '../lib/output.mjs';

const noGlobals = { json: false, quiet: false, noColor: false };
const tty = { isTTY: true };
const pipe = { isTTY: false };

test('TTY 면 사람용', () => {
  assert.equal(resolveMode(noGlobals, { stdout: tty }), 'human');
});

test('파이프면 기계용', () => {
  assert.equal(resolveMode(noGlobals, { stdout: pipe }), 'json');
});

test('--json 은 TTY 여도 기계용', () => {
  assert.equal(resolveMode({ ...noGlobals, json: true }, { stdout: tty }), 'json');
});

test('모드는 stdout 만 본다 — stderr 는 관계없다', () => {
  assert.equal(resolveMode(noGlobals, { stdout: tty, stderr: pipe }), 'human');
  assert.equal(resolveMode(noGlobals, { stdout: pipe, stderr: tty }), 'json');
});

test('TTY 면 색이 켜진다', () => {
  assert.equal(resolveColor(noGlobals, {}, tty), true);
});

test('파이프면 색이 꺼진다', () => {
  assert.equal(resolveColor(noGlobals, {}, pipe), false);
});

test('NO_COLOR 는 값과 무관하게 끈다', () => {
  assert.equal(resolveColor(noGlobals, { NO_COLOR: '' }, tty), false);
  assert.equal(resolveColor(noGlobals, { NO_COLOR: '0' }, tty), false);
});

test('TERM=dumb 는 끈다', () => {
  assert.equal(resolveColor(noGlobals, { TERM: 'dumb' }, tty), false);
});

test('--no-color 와 HEADERLAB_NO_COLOR 는 끈다', () => {
  assert.equal(resolveColor({ ...noGlobals, noColor: true }, {}, tty), false);
  assert.equal(resolveColor(noGlobals, { HEADERLAB_NO_COLOR: '1' }, tty), false);
});

test('FORCE_COLOR 는 비TTY 도 되켠다', () => {
  assert.equal(resolveColor(noGlobals, { FORCE_COLOR: '1' }, pipe), true);
});

// 이 하나가 스펙 §6 의 스트림별 판정이다. stdout 을 파일로 돌리고 에러를
// 화면에서 읽는 것은 흔한 사용이며, 그때 에러는 색을 가져야 한다.
test('판정은 스트림마다 따로다', () => {
  assert.equal(resolveColor(noGlobals, {}, pipe), false);
  assert.equal(resolveColor(noGlobals, {}, tty), true);
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd packages/headerlab && node --test test/output.test.mjs
```
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현한다**

`packages/headerlab/lib/output.mjs`:

```js
/**
 * 이 패키지에서 TTY 와 환경변수의 뜻을 아는 유일한 곳. `render.mjs` 는
 * 순수하게 문자열을 만들고, 그 문자열이 어디로 어떤 모습으로 갈지는
 * 여기가 정한다.
 *
 * 두 함수 다 `process` 를 전역으로 읽지 않고 인자로 받는다 — 조합이
 * 열 가지가 넘고, 그걸 프로세스를 띄워 가며 검사하는 것과 표로 검사하는
 * 것은 비용이 다르다.
 */

/**
 * 기계용인가 사람용인가. **stdout 만 본다** — 모드는 주 출력이 어디로
 * 가는지의 문제이고, stderr 가 파이프인지 여부는 그것과 무관하다.
 */
export function resolveMode(globals, streams) {
  if (globals.json) return 'json';
  return streams.stdout?.isTTY ? 'human' : 'json';
}

/**
 * 이 스트림에 색을 칠할 것인가. clig Output §13 의 목록 그대로이며,
 * 판정을 스트림마다 따로 하는 것이 중요하다: 사람용 실패는 stderr 로
 * 가므로, stdout 의 TTY 여부로만 정하면 `headerlab status > out.txt` 가
 * 화면에 남는 에러를 흑백으로 만들고 `2> err.txt` 는 파일에 이스케이프를
 * 적는다.
 *
 * `FORCE_COLOR` 가 마지막에 오는 것이 아니라 `NO_COLOR` 계열보다 약한
 * 것이 의도다 — 끄라는 요청이 켜라는 요청을 이긴다.
 */
export function resolveColor(globals, env, stream) {
  if (globals.noColor) return false;
  if (env.NO_COLOR !== undefined) return false;
  if (env.HEADERLAB_NO_COLOR !== undefined) return false;
  if (env.TERM === 'dumb') return false;
  if (env.FORCE_COLOR !== undefined) return true;
  return Boolean(stream?.isTTY);
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
cd packages/headerlab && node --test test/output.test.mjs
```
Expected: PASS (11 tests)

- [ ] **Step 5: 커밋**

```bash
git add packages/headerlab/lib/output.mjs packages/headerlab/test/output.test.mjs
git commit -m "feat: decide output mode and colour per stream"
```

---

### Task 7: 배선 — 도움말·버전·사람용 기본값이 켜진다

여기서 CLI 의 겉모습이 실제로 바뀐다.

**Files:**
- Modify: `packages/headerlab/bin/headerlab.mjs`
- Modify: `packages/headerlab/test/headerlab.test.mjs`

**Interfaces:**
- Consumes: Task 1–6 전부
- Produces: 없음 (배선)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/headerlab/test/headerlab.test.mjs` 에 덧붙인다. (`runCli` 는 이미 그 파일 위쪽에 있다.)

```js
test('--help 가 도움말을 stdout 에 내고 0 으로 나간다', async () => {
  const { code, stdout, stderr } = await runCli(['--help']);
  assert.equal(code, 0);
  assert.equal(stderr, '');
  assert.equal(stdout.includes('USAGE'), true);
  assert.equal(stdout.includes('https://github.com/say8425/headerlab/issues'), true);
});

test('-h 도 같다', async () => {
  const { code, stdout } = await runCli(['-h']);
  assert.equal(code, 0);
  assert.equal(stdout.includes('USAGE'), true);
});

test('맨손 호출이 도움말이고 에러가 아니다', async () => {
  const { code, stdout, stderr } = await runCli([]);
  assert.equal(code, 0);
  assert.equal(stderr, '');
  assert.equal(stdout.includes('USAGE'), true);
});

test('help <cmd> 가 그 명령의 도움말을 낸다', async () => {
  const { code, stdout } = await runCli(['help', 'rule', 'add']);
  assert.equal(code, 0);
  assert.equal(stdout.includes('--target'), true);
  assert.equal(stdout.includes('--op'), true);
});

test('<cmd> --help 가 그 명령의 도움말을 낸다', async () => {
  const { code, stdout } = await runCli(['bridge', 'install', '--help']);
  assert.equal(code, 0);
  assert.equal(stdout.includes('--extension-id'), true);
});

test('--version 이 package.json 의 버전을 낸다', async () => {
  const { code, stdout } = await runCli(['--version']);
  const expected = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ).version;
  assert.equal(code, 0);
  assert.equal(stdout.trim(), expected);
});

test('오타에 제안이 붙고 2 로 나간다', async () => {
  const { code, stdout, stderr } = await runCli(['sight', 'add', 'x']);
  assert.equal(code, 2);
  // 기계용 모드(파이프)이므로 봉투는 stdout 이다.
  assert.equal(stdout.includes('unknown command: sight'), true);
  assert.equal(stdout.includes('did you mean "site"?'), true);
  assert.equal(stderr, '');
});

test('파이프로 부르면 기계용이고 봉투가 그대로다', async () => {
  const { code, stdout } = await runCli(['site', 'add', 'example.com']);
  assert.equal(code, 3);
  const parsed = JSON.parse(stdout);
  assert.deepEqual(parsed, {
    ok: false,
    error: { code: 'bridge-off', message: 'no bridge is running' },
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd packages/headerlab && node --test test/headerlab.test.mjs
```
Expected: FAIL — `--help` 가 여전히 `unknown-command`, exit 1

- [ ] **Step 3: `bin/headerlab.mjs` 를 다시 배선한다**

파일 위쪽 import 에 더한다:

```js
import { findCommand, GROUPS, pathKey } from '../lib/commands.mjs';
import { allPaths, commandHelp, topHelp, usageLine } from '../lib/help.mjs';
import { renderError, renderResult } from '../lib/render.mjs';
import { resolveColor, resolveMode } from '../lib/output.mjs';
import { suggest } from '../lib/suggest.mjs';
import { EXIT, exitFor } from '../lib/exit.mjs';
```

`printResult`/`fail` 을 지우고 모드를 아는 출력 함수로 갈아끼운다:

```js
// 모드는 한 번만 정하고 프로세스 수명 동안 유지한다. 명령마다 다시
// 정하면 같은 실행 안에서 두 형식이 섞일 수 있고, 그건 파싱하는 쪽에
// 최악이다.
let MODE = 'json';
let COLOR_OUT = false;
let COLOR_ERR = false;

function emitOk(payload, command) {
  if (MODE === 'json') {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  if (GLOBALS.quiet) return;
  const text = renderResult(payload, { command, color: COLOR_OUT });
  if (text.length > 0) process.stdout.write(`${text}\n`);
}

function emitFail(code, message) {
  if (MODE === 'json') {
    // 기계용 모드에서 에러 객체는 진단이 아니라 주 출력이다 — `jq` 가
    // stdout 에서 받아야 기존 계약이 바이트 그대로 유지된다. 스트림
    // 선택을 형식 계약의 일부로 본다 (설계 §2.2, clig 로부터의 의도적 이탈).
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code, message } })}\n`);
  } else {
    process.stderr.write(`${renderError({ code, message }, { color: COLOR_ERR })}\n`);
  }
  process.exitCode = exitFor(code);
}

function emitPlain(text) {
  process.stdout.write(`${text}\n`);
}
```

`main()` 을 다시 쓴다:

```js
let GLOBALS;

async function main() {
  const { globals, rest } = extractGlobals(process.argv.slice(2));
  GLOBALS = globals;
  MODE = resolveMode(globals, process);
  COLOR_OUT = resolveColor(globals, process.env, process.stdout);
  COLOR_ERR = resolveColor(globals, process.env, process.stderr);

  // 도움말과 버전이 전역 플래그 오류보다 먼저다. `--bridge` 를 잘못 친
  // 사람이 가장 필요로 하는 것이 도움말인데, 그걸 못 보고 죽으면 안 된다.
  if (globals.version) {
    emitPlain(readPackageVersion());
    return;
  }
  if (globals.help || rest.length === 0) {
    emitPlain(helpTextFor(rest));
    return;
  }
  if (rest[0] === 'help') {
    emitPlain(helpTextFor(rest.slice(1)));
    return;
  }
  if (globals.error !== null) {
    emitFail('usage', globals.error);
    return;
  }

  const parsed = parse(rest);
  if (!parsed.ok) {
    emitFail(parsed.error.code, withSuggestion(parsed.error, rest));
    return;
  }
  // …이하 기존 흐름. printResult/fail 호출을 emitOk/emitFail 로 바꾸고,
  // emitOk 에는 그 명령의 path 를 넘긴다.
}

function readPackageVersion() {
  const url = new URL('../package.json', import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')).version;
}

/** 인자가 없으면 최상위, 알려진 명령이면 그 명령, 모르면 최상위. */
function helpTextFor(argv) {
  if (argv.length === 0) return topHelp();
  const entry = findCommand(argv);
  return entry ? commandHelp(entry) : topHelp();
}

/**
 * 오타 제안을 에러 메시지에 붙인다. 그룹 이름과 전체 경로 양쪽을
 * 후보로 삼는다 — 사람은 `sight add` 도 치고 `site addd` 도 친다.
 */
function withSuggestion(error, argv) {
  if (error.code !== 'unknown-command') return error.message;
  const hint = suggest(argv[0] ?? '', GROUPS) ?? suggest(argv.join(' '), allPaths());
  return hint === null ? error.message : `${error.message} — did you mean "${hint}"?`;
}
```

`emitOk` 호출부는 명령 경로가 필요하다. `parsed.command.cmd` 대신 표를 쓴다:

```js
  const entry = findCommand(rest);
  const commandPath = entry ? entry.path : [rest[0]];
```
그리고 `emitOk(result, commandPath)`.

`test/headerlab.test.mjs` 위쪽에 `readFileSync` 와 `fileURLToPath` 가 이미
import 되어 있는지 확인하고, 없으면 더한다.

- [ ] **Step 4: 통과를 확인한다**

```bash
cd packages/headerlab && node --test
```
Expected: PASS 전부

- [ ] **Step 5: 사람용 기본값을 실제 터미널에서 본다**

```bash
script -q /dev/null node bin/headerlab.mjs site add example.com; echo "exit=$?"
```
Expected: stdout 이 비고, stderr 에 색이 붙은 `no bridge is running.` 세 줄, `exit=3`

- [ ] **Step 6: 커밋**

```bash
git add packages/headerlab/bin/headerlab.mjs packages/headerlab/test/headerlab.test.mjs
git commit -m "feat: show help, print a version, and default to human output on a tty"
```

---

### Task 8: 닫힌 파이프·SIGINT·예상 못 한 예외

**Files:**
- Modify: `packages/headerlab/bin/headerlab.mjs`
- Create: `packages/headerlab/test/process.test.mjs`

**Interfaces:**
- Consumes: Task 4 의 `ISSUES_URL`
- Produces: 없음

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/headerlab/test/process.test.mjs`:

```js
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// 프로세스를 실제로 띄워야만 보이는 것들. 닫힌 파이프·시그널·pty 는
// 모듈을 import 해서는 관측되지 않는다.
const cliPath = fileURLToPath(new URL('../bin/headerlab.mjs', import.meta.url));

function run(args, { onSpawn } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    onSpawn?.(child);
  });
}

test('stdout 파이프가 먼저 닫혀도 스택 트레이스를 쏟지 않는다', async () => {
  const { code, stderr } = await new Promise((resolve) => {
    const child = spawn(
      'sh',
      ['-c', `"${process.execPath}" "${cliPath}" bridge status | true`],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stderrText = '';
    child.stderr.on('data', (c) => (stderrText += c));
    child.on('close', (exitCode) => resolve({ code: exitCode, stderr: stderrText }));
  });
  // 부재를 먼저: 이 결함은 1106바이트의 존재로 드러났다.
  assert.equal(stderr.includes('Unhandled'), false);
  assert.equal(stderr.includes('EPIPE'), false);
  assert.equal(stderr, '');
  assert.equal(code, 0);
});

test('SIGINT 가 한 줄을 남기고 130 으로 나간다', async () => {
  const { code, signal, stderr } = await run(['site', 'add', 'example.com'], {
    onSpawn: (child) => setTimeout(() => child.kill('SIGINT'), 150),
  });
  // 브릿지가 없으면 즉시 끝나므로, 이 테스트는 브릿지가 없을 때
  // 죽기 전에 SIGINT 가 닿는 경우만 검사한다. 이미 끝났다면 통과다.
  if (signal === null && code === 3) return;
  assert.equal(stderr.includes('interrupted'), true);
  assert.equal(code, 130);
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd packages/headerlab && node --test test/process.test.mjs
```
Expected: FAIL — 첫 테스트가 `stderr` 에 `Unhandled 'error' event` 를 받는다

- [ ] **Step 3: 구현한다**

`bin/headerlab.mjs` 의 `await main()` **앞에** 놓는다:

```js
/**
 * 닫힌 파이프는 오류가 아니라 정상 종료다. `headerlab state get --json | head`
 * 처럼 앞부분만 읽고 그만두는 것은 정당한 사용인데, 핸들러가 없으면 Node 의
 * 기본 경로가 25줄 1106바이트짜리 스택 트레이스를 stderr 로 쏟는다 — 측정치다.
 * clig Output §17 과 Errors §4 를 동시에 어긴다.
 */
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(EXIT.OK);
  throw error;
});

/**
 * Ctrl-C 는 한 줄을 남기고 나간다. 이전에는 exit 130 은 맞았지만 stdout·
 * stderr 둘 다 0바이트였다 — 이 CLI 가 스스로 약속한 "모든 결과는 봉투
 * 하나" 조차 안 나왔다. 두 번째 Ctrl-C 는 정리를 건너뛰고 즉시 나간다.
 */
let interrupting = false;
process.on('SIGINT', () => {
  if (interrupting) process.exit(130);
  interrupting = true;
  process.stderr.write('interrupted — no command was delivered\n');
  process.exit(130);
});

/**
 * 여기 오는 것은 이 CLI 가 의도해서 낸 실패가 아니라 버그다. 의도된
 * 실패 열일곱 가지는 이미 사람이 읽을 문장으로 다시 쓰여 `emitFail` 로
 * 나가므로, 버그 신고를 권할 대상이 아니다 (clig Errors §1 대 §4).
 */
process.on('uncaughtException', (error) => {
  const title = encodeURIComponent(`crash: ${error.message}`);
  const body = encodeURIComponent(
    [
      `headerlab ${readPackageVersion()}`,
      `node ${process.version} · ${process.platform} ${process.arch}`,
      `argv: ${process.argv.slice(2).join(' ')}`,
      '',
      '```',
      error.stack ?? String(error),
      '```',
    ].join('\n'),
  );
  process.stderr.write(
    [
      `headerlab crashed: ${error.message}`,
      'This is a bug — nothing was left half-done that the next run cannot redo.',
      `Report it: ${ISSUES_URL}/new?title=${title}&body=${body}`,
      '',
    ].join('\n'),
  );
  process.exit(EXIT.FAILED);
});
```

`ISSUES_URL` 을 `../lib/help.mjs` 에서 import 하고, `readPackageVersion` 이
이 블록보다 위에 정의되어 있는지 확인한다 (함수 선언이므로 호이스팅되지만,
`uncaughtException` 은 실행 시점에만 호출되므로 어느 쪽이든 안전하다).

- [ ] **Step 4: 통과를 확인한다**

```bash
cd packages/headerlab && node --test test/process.test.mjs
node bin/headerlab.mjs bridge status | true; echo "exit=${PIPESTATUS[0]}"
```
Expected: PASS · stderr 없음

- [ ] **Step 5: 커밋**

```bash
git add packages/headerlab/bin/headerlab.mjs packages/headerlab/test/process.test.mjs
git commit -m "fix: exit quietly on a closed pipe, say something on Ctrl-C, and offer a bug URL on a crash"
```

---

### Task 9: `state set` 안전장치

**Files:**
- Modify: `packages/headerlab/bin/headerlab.mjs`
- Modify: `packages/headerlab/test/headerlab.test.mjs`, `packages/headerlab/test/process.test.mjs`

**Interfaces:**
- Consumes: Task 2 의 `globals.force`/`globals.noInput`
- Produces: 없음

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/headerlab.test.mjs` 에 덧붙인다:

```js
test('비대화형 state set 은 --force 를 요구한다', async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'hl-')), 'state.json');
  writeFileSync(file, JSON.stringify({ profiles: [] }));
  const { code, stdout } = await runCli(['state', 'set', file]);
  assert.equal(code, 2);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.error.code, 'usage');
  assert.equal(
    parsed.error.message,
    'state set replaces the entire stored state and cannot be undone; pass --force to confirm',
  );
});

test('--force 를 주면 통과해 브릿지까지 간다', async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'hl-')), 'state.json');
  writeFileSync(file, JSON.stringify({ profiles: [] }));
  const { code, stdout } = await runCli(['state', 'set', file, '--force']);
  // 브릿지가 없으므로 bridge-off 까지 갔다는 것이 확인의 증거다.
  assert.equal(code, 3);
  assert.equal(JSON.parse(stdout).error.code, 'bridge-off');
});

test('--no-input 은 어떤 플래그를 치라고 말한다', async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'hl-')), 'state.json');
  writeFileSync(file, JSON.stringify({ profiles: [] }));
  const { code, stdout } = await runCli(['state', 'set', file, '--no-input']);
  assert.equal(code, 2);
  assert.equal(JSON.parse(stdout).error.message.includes('--force'), true);
});
```

`test/process.test.mjs` 에 덧붙인다:

```js
test('state set - 은 터미널에서 멈추지 않는다', async () => {
  // stdin 을 상속시키면 부모의 stdin 이 붙는데, node:test 아래에서는
  // TTY 가 아니다. isTTY 를 강제하는 대신 `-` 에 아무것도 안 보내고
  // 닫아서, 멈추지 않고 답이 나오는지만 본다. TTY 경로는 아래 손 확인.
  const child = spawn(process.execPath, [cliPath, 'state', 'set', '-', '--force'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end();
  const finished = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('hung'), 3000);
    child.on('close', () => {
      clearTimeout(timer);
      resolve('exited');
    });
  });
  child.kill();
  assert.equal(finished, 'exited');
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd packages/headerlab && node --test test/headerlab.test.mjs
```
Expected: FAIL — `state set <file>` 이 확인 없이 `bridge-off` 까지 간다

- [ ] **Step 3: 구현한다**

`bin/headerlab.mjs` 의 `resolveStateCommand` 앞에 넣는다:

```js
const STATE_SET_CONFIRM =
  'state set replaces the entire stored state and cannot be undone; pass --force to confirm';

/**
 * `state set` 은 되돌릴 수 없는 전체 덮어쓰기다 (clig Arguments §10).
 *
 * 비대화형에서 조용히 진행하지 않고 `--force` 를 요구하는 쪽을 택했다.
 * 반대쪽 — 파이프면 그냥 진행 — 은 확인이 사람에게만 걸리고 스크립트에는
 * 안 걸린다는 뜻이고, 스크립트가 훨씬 더 많은 상태를 훨씬 더 빨리 지운다.
 * clig Interactivity §2 가 "물어볼 수 없으면 어떤 플래그를 치라고 알려주며
 * 실패하라" 고 말하는 것이 정확히 이 경우다.
 */
async function confirmStateSet(source) {
  if (GLOBALS.force) return true;
  if (GLOBALS.noInput) {
    emitFail('usage', STATE_SET_CONFIRM);
    return false;
  }
  // 소스가 `-` 이면 stdin 은 payload 이므로 물어볼 데가 없다.
  if (source === '-' || !process.stdin.isTTY) {
    emitFail('usage', STATE_SET_CONFIRM);
    return false;
  }

  process.stderr.write('This replaces the entire stored state and cannot be undone.\n');
  process.stderr.write('Continue? [y/N] ');
  const answer = await new Promise((resolve) => {
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (chunk) => resolve(chunk.trim().toLowerCase()));
  });
  if (answer === 'y' || answer === 'yes') return true;
  emitFail('usage', 'cancelled');
  return false;
}
```

`readStdin()` 에 TTY 가드를 넣는다:

```js
function readStdin() {
  // 측정된 결함: 가드가 없으면 실제 pty 에서 영원히 멈춘다. 5초 뒤에도
  // 실행 중이고 stdout·stderr 둘 다 0바이트라, 사용자는 뭘 기다리는지
  // 알 방법 없이 커서만 본다. clig Help §11.
  if (process.stdin.isTTY) {
    const error = new Error('state set - reads JSON from stdin; pipe it in or pass a file path');
    error.code = 'usage';
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks)));
    process.stdin.on('error', reject);
  });
}
```

`main()` 의 `state.set` 분기를 고친다:

```js
  if (command.cmd === 'state.set') {
    if (!(await confirmStateSet(command.state.source))) return;
    try {
      command = await resolveStateCommand(command);
    } catch (error) {
      emitFail(error.code ?? 'invalid-args', error.message);
      return;
    }
  }
```

`commands.mjs` 의 `state set` 항목에 플래그와 예제를 더한다:

```js
    flags: [{ name: '--force', summary: 'confirm the overwrite (required when not on a terminal)' }],
    examples: ['headerlab state set state.json --force', 'headerlab state get --json | jq .state | headerlab state set - --force'],
```

두 번째 예제는 `help.test.mjs` 의 "모든 예제가 파싱된다" 를 통과해야 한다.
파이프가 들어간 문자열은 `split(' ')` 로 잘리므로 그 테스트가 깨진다 —
`help.test.mjs` 의 그 테스트에서 `|` 를 포함한 예제는 건너뛰도록 한 줄
더한다:

```js
      if (example.includes('|')) continue; // 파이프라인 예제는 argv 하나가 아니다
```

- [ ] **Step 4: 통과를 확인한다**

```bash
cd packages/headerlab && node --test
```
Expected: PASS 전부

- [ ] **Step 5: TTY 경로를 손으로 확인한다**

```bash
script -q /dev/null node bin/headerlab.mjs state set - ; echo "exit=$?"
```
Expected: 즉시 `state set - reads JSON from stdin…`, `exit=2` — **멈추지 않는다**

- [ ] **Step 6: 커밋**

```bash
git add packages/headerlab/bin/headerlab.mjs packages/headerlab/lib/commands.mjs \
        packages/headerlab/test/
git commit -m "fix: confirm state set before overwriting, and never hang on a terminal"
```

---

### Task 10: `rule add --value-file`

**Files:**
- Modify: `packages/headerlab/lib/args.mjs`, `packages/headerlab/lib/commands.mjs`, `packages/headerlab/bin/headerlab.mjs`
- Modify: `packages/headerlab/test/args.test.mjs`, `packages/headerlab/test/headerlab.test.mjs`

**Interfaces:**
- Consumes: 없음
- Produces: `parse(['rule','add','--target','request','--op','set','--value-file','p'])` 가
  `{cmd:'rule.add', target, operation, name, value: {source: 'p'}}` 를 준다 — `state.set` 이
  `{source}` 를 쓰는 것과 같은 형태다. `bin/` 이 소켓 이전에 해소한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/args.test.mjs`:

```js
test('rule add --value-file 은 읽을 자리를 실어 보낸다', () => {
  assert.deepEqual(
    parse(['rule', 'add', '--target', 'request', '--op', 'set', '--name', 'A', '--value-file', 'secret.txt']),
    {
      ok: true,
      command: { cmd: 'rule.add', target: 'request', operation: 'set', name: 'A', value: { source: 'secret.txt' } },
    },
  );
});

test('rule add 는 --value 와 --value-file 을 동시에 받지 않는다', () => {
  assert.deepEqual(
    parse(['rule', 'add', '--target', 'request', '--op', 'set', '--value', 'x', '--value-file', 'p']),
    {
      ok: false,
      error: { code: 'invalid-args', message: 'rule add takes --value or --value-file, not both' },
    },
  );
});

test('rule add 는 --value 없이도 여전히 된다', () => {
  assert.deepEqual(parse(['rule', 'add', '--target', 'request', '--op', 'remove']), {
    ok: true,
    command: { cmd: 'rule.add', target: 'request', operation: 'remove', name: '', value: '' },
  });
});
```

`test/headerlab.test.mjs`:

```js
test('--value-file 의 내용이 값이 된다', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hl-'));
  const file = path.join(dir, 'secret.txt');
  writeFileSync(file, 'Bearer TOPSECRET\n');
  const { code, stdout } = await runCli([
    'rule', 'add', '--target', 'request', '--op', 'set', '--name', 'Authorization',
    '--value-file', file,
  ]);
  // 브릿지가 없으므로 bridge-off 까지 갔다는 것이 파일이 읽혔다는 증거다.
  assert.equal(code, 3);
  assert.equal(JSON.parse(stdout).error.code, 'bridge-off');
});

test('--value-file 이 없는 파일이면 2 로 나간다', async () => {
  const { code, stdout } = await runCli([
    'rule', 'add', '--target', 'request', '--op', 'set', '--value-file', '/nope/nothing',
  ]);
  assert.equal(code, 2);
  assert.equal(JSON.parse(stdout).error.code, 'invalid-args');
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd packages/headerlab && node --test test/args.test.mjs
```
Expected: FAIL — `Unknown option '--value-file'`

- [ ] **Step 3: 구현한다**

`lib/args.mjs` 의 `parseRuleAdd`:

```js
function parseRuleAdd(args) {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        target: { type: 'string' },
        op: { type: 'string' },
        name: { type: 'string' },
        value: { type: 'string' },
        'value-file': { type: 'string' },
      },
      allowPositionals: false,
    }));
  } catch (error) {
    return invalidArgs(`rule add: ${error.message}`);
  }

  if (!RULE_TARGETS.includes(values.target)) {
    return invalidArgs(
      `rule add needs --target ${RULE_TARGETS.join('|')}, got: ${values.target ?? '(missing)'}`,
    );
  }
  if (!RULE_OPERATIONS.includes(values.op)) {
    return invalidArgs(
      `rule add needs --op ${RULE_OPERATIONS.join('|')}, got: ${values.op ?? '(missing)'}`,
    );
  }
  // 둘 중 하나가 조용히 이기면, 비밀값을 파일에 두려던 사람이 왜
  // argv 의 값이 나갔는지 알 길이 없다.
  if (values.value !== undefined && values['value-file'] !== undefined) {
    return invalidArgs('rule add takes --value or --value-file, not both');
  }

  // `{source}` 는 `state.set` 이 이미 쓰는 형태다 — 이 파일은 순수하므로
  // 파일을 읽지 않고 *읽을 자리*를 실어 보내고, bin/headerlab.mjs 가
  // 소켓 이전에 해소한다.
  const value =
    values['value-file'] === undefined
      ? (values.value ?? '')
      : { source: values['value-file'] };

  return {
    ok: true,
    command: {
      cmd: 'rule.add',
      target: values.target,
      operation: values.op,
      name: values.name ?? '',
      value,
    },
  };
}
```

`bin/headerlab.mjs` — `main()` 의 `state.set` 분기 옆에 더한다:

```js
  if (command.cmd === 'rule.add' && typeof command.value === 'object') {
    try {
      command = { ...command, value: readValueFile(command.value.source) };
    } catch (error) {
      emitFail('invalid-args', error.message);
      return;
    }
  }
```

그리고 함수:

```js
/**
 * `--value-file` 을 읽는다. 이 플래그가 있는 이유는 측정된 노출이다:
 * `--value 'Bearer TOPSECRET123'` 이 `ps -ax -o pid,command` 에 그대로
 * 찍힌다. 헤더 값은 Authorization·Cookie·X-Api-Key 가 사는 곳이고,
 * 숨은 트래커 때문에 존재하는 프로젝트가 사용자 토큰을 같은 머신의 모든
 * 계정에 노출할 수는 없다 (clig Arguments §14).
 *
 * 끝의 개행 하나만 떼는 것은 `echo 'x' > f` 가 흔하기 때문이고, 그 이상
 * 다듬지 않는 것은 헤더 값에 공백이 의미를 가질 수 있기 때문이다.
 */
function readValueFile(source) {
  let raw;
  try {
    raw = readFileSync(source, 'utf8');
  } catch (error) {
    throw new Error(`could not read ${source}: ${error.message}`);
  }
  return raw.replace(/\n$/, '');
}
```

`lib/commands.mjs` 의 `rule add` 플래그 목록에 더한다:

```js
      { name: '--value-file', arg: '<path>', summary: 'read the value from a file — use this for secrets' },
```
그리고 `--value` 의 요약을 바꾼다:
```js
      { name: '--value', arg: '<value>', summary: 'the header value — lands in ps output and shell history' },
```

- [ ] **Step 4: 통과를 확인한다**

```bash
cd packages/headerlab && node --test
```
Expected: PASS 전부

- [ ] **Step 5: 커밋**

```bash
git add packages/headerlab/lib/ packages/headerlab/bin/ packages/headerlab/test/
git commit -m "feat: read a rule value from a file so secrets stay out of ps"
```

---

### Task 11: `bridge install --dry-run`

**Files:**
- Modify: `packages/headerlab/lib/args.mjs`, `packages/headerlab/lib/install.mjs`, `packages/headerlab/lib/commands.mjs`, `packages/headerlab/bin/headerlab.mjs`, `packages/headerlab/lib/render.mjs`
- Modify: `packages/headerlab/test/install.test.mjs`, `packages/headerlab/test/args.test.mjs`

**Interfaces:**
- Consumes: `installBridge({manifestDir, launcherDir, socketDirPath, extensionId})`
- Produces: `previewInstall(paths): {ok: true, dryRun: true, manifestPath, launcherPath, extensionId, manifest: object}` — 아무것도 쓰지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/args.test.mjs`:

```js
test('bridge install --dry-run 이 명령에 실린다', () => {
  const result = parse(['bridge', 'install', '--extension-id', 'a'.repeat(32), '--dry-run']);
  assert.equal(result.ok, true);
  assert.equal(result.command.dryRun, true);
});

test('--dry-run 을 안 주면 false 다', () => {
  const result = parse(['bridge', 'install', '--extension-id', 'a'.repeat(32)]);
  assert.equal(result.command.dryRun, false);
});
```

`test/install.test.mjs`:

```js
import { previewInstall } from '../lib/install.mjs';

test('previewInstall 은 아무 파일도 만들지 않는다', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hl-dry-'));
  const paths = {
    manifestDir: path.join(dir, 'manifests'),
    launcherDir: path.join(dir, 'bin'),
    socketDirPath: path.join(dir, 'sock'),
    extensionId: 'a'.repeat(32),
  };
  const result = await previewInstall(paths);

  // 부재를 먼저 검사한다 — 이 명령의 존재 이유가 "아무것도 안 쓴다" 이므로.
  assert.equal(existsSync(paths.manifestDir), false);
  assert.equal(existsSync(paths.launcherDir), false);
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.extensionId, 'a'.repeat(32));
  assert.deepEqual(result.manifest.allowed_origins, [`chrome-extension://${'a'.repeat(32)}/`]);
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd packages/headerlab && node --test test/install.test.mjs test/args.test.mjs
```
Expected: FAIL — `previewInstall` 없음, `--dry-run` 이 `Unknown option`

- [ ] **Step 3: 구현한다**

`lib/args.mjs` 의 `parseBridgeInstall` 에서 `options` 에 더한다:

```js
        'dry-run': { type: 'boolean' },
```
그리고 반환에 더한다:
```js
    dryRun: values['dry-run'] ?? false,
```

`lib/install.mjs` — 매니페스트를 만드는 기존 코드를 함수로 뽑고 (이미 그런
헬퍼가 있으면 그것을 쓴다), 그 아래 더한다:

```js
/**
 * `bridge install` 이 무엇을 쓸지만 보여주고 아무것도 쓰지 않는다.
 *
 * 장식이 아니라 알려진 함정의 해독제다: `--load-path` 에서 계산한 id 가
 * Chrome 이 실제로 부여한 id 와 다르면 설치는 깨끗이 성공하고 브릿지는
 * 영원히 연결되지 않으며, Chrome 은 매니페스트가 아예 없을 때와 같은
 * 메시지를 낸다. `allowed_origins` 는 와일드카드를 받지 않으므로 오타 한
 * 글자가 조용한 실패가 된다. 쓰기 전에 눈으로 대조할 기회를 준다.
 */
export async function previewInstall({ manifestDir, launcherDir, socketDirPath, extensionId }) {
  const manifestPath = manifestPathIn(manifestDir);
  const launcherPath = launcherPathIn(launcherDir);
  return {
    ok: true,
    dryRun: true,
    manifestPath,
    launcherPath,
    extensionId,
    manifest: hostManifest({ extensionId, launcherPath }),
  };
}
```

`hostManifest`/`manifestPathIn`/`launcherPathIn` 이 이 파일에 이미 있는
이름과 다르면 실제 이름에 맞춘다. `socketDirPath` 는 서명을 `installBridge`
와 같게 유지하기 위해 받고 쓰지 않는다.

`bin/headerlab.mjs` 의 `runBridgeCommand`:

```js
  if (command.dryRun) {
    emitOk(await previewInstall({ ...paths, extensionId }), ['bridge', 'install']);
    return;
  }
```
(`const extensionId = …` 줄 바로 다음에.)

`lib/render.mjs` 의 `renderBridgeInstall` 을 dry-run 을 알게 고친다:

```js
function renderBridgeInstall(payload, color) {
  const verb = payload.dryRun ? 'would install' : 'installed';
  const lines = [
    `${pad(verb, 11)}${paint(payload.manifestPath, COLORS.dim, color)}`,
    `${pad('launcher', 11)}${paint(payload.launcherPath, COLORS.dim, color)}`,
    `${pad('extension', 11)}${payload.extensionId}`,
  ];
  if (payload.dryRun) {
    lines.push('', 'manifest:', JSON.stringify(payload.manifest, null, 2), '', 'Nothing was written.');
  }
  if (payload.note) lines.push('', payload.note);
  return lines.join('\n');
}
```

`test/render.test.mjs` 의 기존 `bridge install` 기대값이 있으면 새 폭에 맞춘다.

`lib/commands.mjs` 의 `bridge install` 플래그에 더한다:

```js
      { name: '-n, --dry-run', summary: 'show what would be written and write nothing' },
```

- [ ] **Step 4: 통과를 확인하고 손으로 본다**

```bash
cd packages/headerlab && node --test
node bin/headerlab.mjs bridge install --extension-id aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --dry-run
ls ~/.headerlab/bin 2>/dev/null || echo "(런처 디렉터리 없음 — 좋다)"
```
Expected: PASS · dry-run 출력 · 실제 파일 없음

**주의:** 이 태스크의 손 확인은 실제 홈 디렉터리를 건드릴 수 있는 유일한
지점이다. `--dry-run` 없이 `bridge install` 을 실행하지 말 것.

- [ ] **Step 5: 커밋**

```bash
git add packages/headerlab/lib/ packages/headerlab/bin/ packages/headerlab/test/
git commit -m "feat: preview a bridge install without writing anything"
```

---

### Task 12: 진행 표시

**Files:**
- Modify: `packages/headerlab/lib/bridge.mjs` (`sendCommand` 에 `onSlow` 훅)
- Modify: `packages/headerlab/bin/headerlab.mjs`
- Modify: `packages/headerlab/test/bridge.test.mjs`

**Interfaces:**
- Consumes: 없음
- Produces: `sendCommand(socketPath, command, {timeoutMs, slowAfterMs = 1000, onSlow})` — `onSlow` 는 응답 전에 `slowAfterMs` 가 지나면 한 번 호출된다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/bridge.test.mjs`:

```js
test('응답이 늦으면 onSlow 가 한 번 불린다', async () => {
  // 연결은 받되 답하지 않는 소켓. 이 파일에 이미 그런 헬퍼가 있으면
  // 그것을 쓴다.
  const dir = mkdtempSync(path.join(tmpdir(), 'hl-slow-'));
  const socketPath = path.join(dir, 'bridge-1.sock');
  const server = createServer(() => {});
  await new Promise((resolve) => server.listen(socketPath, resolve));

  let calls = 0;
  await assert.rejects(
    sendCommand(socketPath, { cmd: 'pause' }, {
      timeoutMs: 300,
      slowAfterMs: 50,
      onSlow: () => (calls += 1),
    }),
    (error) => error.code === 'timeout',
  );
  assert.equal(calls, 1);
  server.close();
});

test('빨리 답하면 onSlow 는 안 불린다', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hl-fast-'));
  const socketPath = path.join(dir, 'bridge-2.sock');
  const server = createServer((socket) => {
    socket.on('data', (chunk) => {
      const { id } = JSON.parse(chunk.toString('utf8'));
      socket.write(`${JSON.stringify({ id, ok: true, changed: false })}\n`);
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));

  let calls = 0;
  const result = await sendCommand(socketPath, { cmd: 'pause' }, {
    timeoutMs: 1000,
    slowAfterMs: 500,
    onSlow: () => (calls += 1),
  });
  assert.deepEqual(result, { ok: true, changed: false });
  assert.equal(calls, 0);
  server.close();
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd packages/headerlab && node --test test/bridge.test.mjs
```
Expected: FAIL — 첫 테스트에서 `calls` 가 0

- [ ] **Step 3: 구현한다**

`lib/bridge.mjs` 의 `sendCommand` 서명과 내부를 고친다:

```js
export function sendCommand(
  socketPath,
  command,
  { timeoutMs = DEFAULT_REPLY_TIMEOUT_MS, slowAfterMs = 1000, onSlow } = {},
) {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const socket = createConnection(socketPath);
    let buffer = '';
    let settled = false;

    function settle(action, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(slowTimer);
      socket.destroy();
      action(value);
    }

    // 측정된 결함: 브릿지가 연결을 받고 답하지 않으면 10초 동안 어느
    // 스트림에도 한 바이트도 나오지 않는다. 그 사이 유일한 신호는
    // 터미널이 안 돌아온다는 것뿐이다 (clig Robustness §2).
    const slowTimer = setTimeout(() => onSlow?.(timeoutMs), slowAfterMs);

    const timer = setTimeout(() => { /* 기존 그대로 */ }, timeoutMs);
    // …나머지는 기존 그대로
```

`bin/headerlab.mjs` 의 `sendCommand` 호출:

```js
    const result = await sendCommand(target.socketPath, command, {
      onSlow: (timeoutMs) => {
        // 사람용일 때만. 파이프로 받는 쪽에 없던 줄을 흘리지 않는다
        // (clig Output §14). stdout 은 어느 모드에서도 손대지 않는다.
        if (MODE === 'human' && !GLOBALS.quiet && process.stderr.isTTY) {
          process.stderr.write(
            `waiting for the extension to reply (${timeoutMs / 1000}s timeout)…\n`,
          );
        }
      },
    });
```

- [ ] **Step 4: 통과를 확인한다**

```bash
cd packages/headerlab && node --test
```
Expected: PASS 전부

- [ ] **Step 5: 커밋**

```bash
git add packages/headerlab/lib/bridge.mjs packages/headerlab/bin/headerlab.mjs \
        packages/headerlab/test/bridge.test.mjs
git commit -m "feat: say something when the extension is slow to reply"
```

---

### Task 13: 확장 — 읽기 쿼리

**Files:**
- Modify: `lib/bridge/protocol.ts`
- Create: `lib/bridge/query.ts`
- Create: `tests/unit/query.test.ts`
- Modify: `tests/unit/purity.test.ts`

**Interfaces:**
- Consumes: `compile`, `routeDiagnostics`, `ruleTally`, `resolveSingleProfile`, `scopingHosts`, `suppressionReason`
- Produces: `querySchema`, `Query`, `parseQuery(input): Query`, `StatusPayload`, `status(state: AppState): StatusPayload`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/query.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { status } from '@/lib/bridge/query';
import { parseQuery, querySchema } from '@/lib/bridge/protocol';
import { bootstrapProfile } from '@/lib/model/defaults';
import type { AppState } from '@/lib/model/types';

const emptyState = (): AppState => ({ version: 2, globalPause: false, profiles: [] });

describe('querySchema', () => {
  it('accepts the one query it declares', () => {
    expect(parseQuery({ cmd: 'status' })).toEqual({ cmd: 'status' });
  });

  it('rejects a write command — this schema is reads only', () => {
    expect(() => parseQuery({ cmd: 'pause' })).toThrow();
    expect(() => parseQuery({ cmd: 'site.add', domains: ['a.com'] })).toThrow();
  });

  it('declares exactly one shape', () => {
    expect(querySchema.options).toHaveLength(1);
  });
});

describe('status', () => {
  it('reports an empty store without inventing a profile', () => {
    const payload = status(emptyState());
    expect(payload.profile).toBeNull();
    expect(payload.tally).toBeNull();
    expect(payload.scopingHosts).toEqual([]);
    expect(payload.state).toEqual(emptyState());
  });

  it('reports the scoping hosts, not filter.domains', () => {
    const profile = bootstrapProfile();
    const state: AppState = {
      version: 2,
      globalPause: false,
      profiles: [{ ...profile, filter: { ...profile.filter, allSites: true, domains: ['a.com'] } }],
    };
    // all-sites 는 저장된 목록을 지우지 않고 컴파일만 안 한다. scopingHosts
    // 가 그 구분을 아는 유일한 술어이고, filter.domains 를 직접 읽으면
    // all-sites 프로필을 좁은 것으로 오판한다.
    expect(status(state).scopingHosts).toEqual([]);
  });

  it('counts rules the way the popup counts them', () => {
    const profile = bootstrapProfile();
    const state: AppState = {
      version: 2,
      globalPause: false,
      profiles: [
        {
          ...profile,
          filter: { ...profile.filter, domains: ['a.com'] },
          headers: [
            { id: 'r1', enabled: true, target: 'request', operation: 'set', name: 'A', value: '1' },
            { id: 'r2', enabled: false, target: 'request', operation: 'set', name: 'B', value: '2' },
            { id: 'r3', enabled: true, target: 'request', operation: 'set', name: '', value: '' },
          ],
        },
      ],
    };
    const { tally } = status(state);
    expect(tally).not.toBeNull();
    expect(tally!.total).toBe(3);
    expect(tally!.off).toBe(1);
    expect(tally!.unfinished).toBe(1);
  });

  it('serialises the diagnostic maps as pairs so they survive JSON', () => {
    const payload = status(emptyState());
    expect(Array.isArray(payload.diagnostics.byRow)).toBe(true);
    expect(Array.isArray(payload.diagnostics.byHost)).toBe(true);
    // JSON.stringify(new Map()) 은 '{}' 다 — 지도를 그대로 실으면 소켓
    // 건너편에서 조용히 빈 객체가 된다.
    expect(JSON.parse(JSON.stringify(payload)).diagnostics.byRow).toEqual([]);
  });

  it('reports globalPause', () => {
    expect(status({ ...emptyState(), globalPause: true }).globalPause).toBe(true);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm test
```
Expected: FAIL — `@/lib/bridge/query` 없음, `parseQuery` 없음

- [ ] **Step 3: `protocol.ts` 에 `querySchema` 를 더한다**

`commandSchema` 선언 **아래**에 넣는다:

```ts
/**
 * 읽기. `commandSchema` 가 쓰기 목록인 것과 짝을 이룬다.
 *
 * 모양이 하나뿐인 것은 의도다. `headerlab status`·`rule ls`·`site ls`·
 * `state get` 넷이 전부 이 하나를 먹고 CLI 쪽에서 다르게 그린다. 읽기
 * 명령이 더 붙어도 렌더만 늘고 프로토콜은 그대로다.
 *
 * 리듀서(`apply()`)를 거치지 않는다 — 상태를 바꾸지 않으므로 `compile()`
 * 과 `ruleTally()` 를 직접 부르면 되고, 그것이 `lib/bridge/query.ts` 다.
 */
export const querySchema = z.discriminatedUnion('cmd', [z.object({ cmd: z.literal('status') })]);

export type Query = z.infer<typeof querySchema>;

/** Throws on failure. Call this at the trust boundary. */
export function parseQuery(input: unknown): Query {
  return querySchema.parse(input);
}
```

- [ ] **Step 4: `lib/bridge/query.ts` 를 만든다**

```ts
import { compile } from '@/lib/compile/compile';
import { suppressionReason } from '@/lib/compile/suppression';
import { scopingHosts } from '@/lib/permissions/origins';
import { resolveSingleProfile } from '@/lib/view/singleProfile';
import { routeDiagnostics, ruleTally } from '@/lib/view/rules';
import type { SuppressionReason } from '@/lib/compile/suppression';
import type { AppState, Diagnostic, Profile } from '@/lib/model/types';
import type { RuleTally } from '@/lib/view/rules';

/**
 * 읽기 쿼리의 답을 만든다. **순수** — `chrome.*` 를 부르지 않고 I/O 를
 * 하지 않으며 입력을 바꾸지 않는다.
 *
 * 어떤 판단도 다시 구현하지 않는다. 팝업이 화면을 그릴 때 쓰는 바로 그
 * 함수들(`compile`·`routeDiagnostics`·`ruleTally`·`resolveSingleProfile`·
 * `scopingHosts`·`suppressionReason`)만 부른다 — CLI 와 팝업이 같은 사실을
 * 두 방식으로 계산하기 시작하면 갈라지고, 그것이 이 저장소에서 가장 비쌌던
 * 결함의 모양이다.
 *
 * **`tests/unit/purity.test.ts` 의 손목록에 이 파일이 이름으로 들어 있어야
 * 한다.** `lib/bridge/` 에는 디렉터리 규칙이 없다 — 같은 디렉터리의
 * `port.ts` 가 어댑터라 규칙을 걸 수 없기 때문이다.
 */
export interface StatusPayload {
  state: AppState;
  profile: Profile | null;
  diagnostics: {
    byRow: [string, Diagnostic[]][];
    byHost: [string, Diagnostic[]][];
    scope: Diagnostic[];
  };
  tally: RuleTally | null;
  scopingHosts: string[];
  suppression: SuppressionReason | null;
  requiredOrigins: string[];
  globalPause: boolean;
}

export function status(state: AppState): StatusPayload {
  const { profile } = resolveSingleProfile(state.profiles);
  const compiled = compile(state);
  const routed = routeDiagnostics(compiled.diagnostics);

  return {
    state,
    profile: profile ?? null,
    // Map 을 쌍 배열로 편다. JSON.stringify(new Map()) 은 '{}' 이므로,
    // 지도를 그대로 실으면 소켓 건너편에서 조용히 빈 객체가 된다.
    diagnostics: {
      byRow: [...routed.byRow],
      byHost: [...routed.byHost],
      scope: routed.scope,
    },
    tally: profile
      ? ruleTally(profile.headers, profile.id, routed.byRow, { live: !state.globalPause })
      : null,
    // `filter.domains` 가 아니라 `scopingHosts` 다. all-sites 는 저장된
    // 목록을 지우지 않고 컴파일만 안 하므로, 목록을 직접 읽으면 all-sites
    // 프로필을 좁은 것으로 오판한다.
    scopingHosts: profile ? scopingHosts(profile.filter) : [],
    suppression: profile ? suppressionReason(profile) : null,
    requiredOrigins: compiled.requiredOrigins,
    globalPause: state.globalPause,
  };
}
```

`SuppressionReason` 과 `RuleTally` 가 실제로 export 되는 이름·경로인지
확인한다 (`lib/compile/suppression.ts:43`, `lib/view/rules.ts:79`).

- [ ] **Step 5: 순수성 가드에 등록한다**

`tests/unit/purity.test.ts` 의 손으로 적은 일곱 파일 목록에 한 줄 더한다:

```ts
  'lib/bridge/query.ts',
```

그 목록 위 주석에 이유를 한 줄 더한다 — `lib/bridge/` 는 `port.ts` 때문에
디렉터리 규칙을 걸 수 없어 파일을 이름으로 적어야 한다는 것.

- [ ] **Step 6: 통과를 확인한다**

```bash
pnpm test
```
Expected: PASS 전부 (`query.test.ts` 포함, `purity.test.ts` 가 새 파일을 검사)

- [ ] **Step 7: 커밋**

```bash
git add lib/bridge/protocol.ts lib/bridge/query.ts tests/unit/query.test.ts tests/unit/purity.test.ts
git commit -m "feat: answer read queries from the same pure functions the popup uses"
```

---

### Task 14: 확장 — `port.ts` 의 분기

**Files:**
- Modify: `lib/bridge/port.ts`
- Modify: `tests/unit/port.test.ts` (없으면 생성)

**Interfaces:**
- Consumes: Task 13 의 `parseQuery`, `status`
- Produces: 없음

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/port.test.ts` 에 (파일이 이미 있으면 덧붙인다):

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

// port.ts 는 chrome.runtime.connectNative 를 부르는 유일한 모듈이고
// fake-browser 는 그것을 던지는 스텁으로 둔다. 그래서 손으로 심은
// 스파이가 필요하다 — 이 저장소가 어댑터를 테스트하는 방식이다.

describe('handleMessage routes reads before writes', () => {
  it('answers a status query without writing state', async () => {
    // 자세한 배선은 이 파일의 기존 테스트를 따른다. 요지 셋:
    //  1. { id, command: { cmd: 'status' } } 를 보내면 답이 온다
    //  2. 답에 state·tally·diagnostics 가 실려 있다
    //  3. setState 스파이가 **한 번도** 불리지 않는다 — 읽기는 쓰기가 아니다
  });
});
```

**구현자에게:** 이 파일의 기존 테스트 배선(포트 스파이를 어떻게 심는지)을
먼저 읽고 그 형태를 따를 것. 위 세 가지가 검사해야 할 내용이며, 특히
**세 번째(`setState` 가 안 불림)를 먼저 assert 한다** — "읽기가 쓰기를
유발하지 않는다" 는 부재의 주장이라 존재의 주장보다 먼저 와야 한다.
`tests/unit/` 에 `port` 를 검사하는 파일이 없으면
`tests/unit/bridgePort.test.ts` 로 새로 만들고, `@webext-core/fake-browser`
를 쓰는 다른 유닛 테스트의 setup 을 본떠 쓴다.

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm test
```
Expected: FAIL — `{cmd:'status'}` 가 `parseCommand` 에서 `invalid-command` 로 거부된다

- [ ] **Step 3: 구현한다**

`lib/bridge/port.ts` 의 `handleMessage` 에서, `parseCommand` 를 시도하기
**전에** 넣는다:

```ts
  // 읽기를 먼저 시도한다. `querySchema` 에 맞으면 리듀서를 거치지 않고
  // 답한다 — 상태를 바꾸지 않으므로 거칠 이유가 없다 (protocol.ts).
  let query;
  try {
    query = parseQuery(envelope.command);
  } catch {
    query = null;
  }

  if (query !== null) {
    let loaded: LoadedState;
    try {
      loaded = await loadState();
    } catch (error) {
      reply(current, id, {
        ok: false,
        error: {
          code: 'store-unwritable',
          message: `the store could not be read: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
      return;
    }
    if (!loaded.valid) {
      // 검증에 실패한 바이트를 사람에게 "상태" 라고 보여주는 것은 이
      // 저장소가 금지하는 "닿을 수 없는 것을 보여주기" 다. 쓰기와 같은
      // 코드로 답한다.
      reply(current, id, {
        ok: false,
        error: {
          code: 'store-unreadable',
          message:
            'the stored state does not match the format this version expects, so there is ' +
            'nothing safe to report',
        },
      });
      return;
    }
    // `patchBridgeStatus({lastCommandAt})` 를 부르지 않는다 — 읽기는
    // 명령이 아니고, 읽었다는 이유로 마지막 명령 시각이 움직이면 팝업이
    // 거짓말을 하게 된다.
    reply(current, id, { ok: true, ...status(loaded.state) });
    return;
  }
```

import 를 더한다:

```ts
import { parseQuery } from '@/lib/bridge/protocol';
import { status } from '@/lib/bridge/query';
```

`reply` 의 타입이 `ApplyResult` 로 좁혀져 있으면
`ApplyResult | ({ ok: true } & StatusPayload)` 로 넓힌다.

- [ ] **Step 4: 통과를 확인한다**

```bash
pnpm test
```
Expected: PASS 전부

- [ ] **Step 5: 커밋**

```bash
git add lib/bridge/port.ts tests/unit/
git commit -m "feat: route read queries past the reducer"
```

---

### Task 15: 읽기 명령 넷

**Files:**
- Modify: `packages/headerlab/lib/args.mjs`, `packages/headerlab/lib/commands.mjs`, `packages/headerlab/lib/render.mjs`, `packages/headerlab/bin/headerlab.mjs`
- Modify: `packages/headerlab/test/args.test.mjs`, `packages/headerlab/test/render.test.mjs`, `packages/headerlab/test/commands.test.mjs`, `packages/headerlab/test/headerlab.test.mjs`

**Interfaces:**
- Consumes: Task 13 의 `StatusPayload`
- Produces: `parse(['status'])` → `{cmd:'status'}`, `parse(['rule','ls'])` → `{cmd:'status'}`,
  `parse(['site','ls'])` → `{cmd:'status'}`, `parse(['state','get'])` → `{cmd:'status'}`.
  넷이 같은 명령을 내고 렌더만 다르다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/args.test.mjs`:

```js
test('읽기 명령 넷이 모두 같은 status 쿼리를 낸다', () => {
  for (const argv of [['status'], ['rule', 'ls'], ['site', 'ls'], ['state', 'get']]) {
    assert.deepEqual(parse(argv), { ok: true, command: { cmd: 'status' } }, argv.join(' '));
  }
});

test('읽기 명령은 인자를 받지 않는다', () => {
  assert.deepEqual(parse(['status', 'extra']), {
    ok: false,
    error: { code: 'invalid-args', message: 'status takes no arguments, got: extra' },
  });
});
```

`test/commands.test.mjs` 의 `PARSER_KNOWS` 에 넷을 더한다:

```js
  'status',
  'site ls',
  'rule ls',
  'state get',
```

`test/render.test.mjs`:

```js
const statusPayload = {
  ok: true,
  globalPause: false,
  scopingHosts: ['a.com'],
  suppression: null,
  tally: { total: 2, live: 1, off: 1, unfinished: 0, blocked: 0 },
  profile: {
    id: 'p1',
    filter: { domains: ['a.com'], allSites: false },
    headers: [
      { id: 'r1', enabled: true, target: 'request', operation: 'set', name: 'A', value: '1' },
      { id: 'r2', enabled: false, target: 'response', operation: 'remove', name: 'B', value: '' },
    ],
  },
  diagnostics: { byRow: [], byHost: [], scope: [] },
  state: { version: 2, globalPause: false, profiles: [] },
};

test('rule ls 가 규칙마다 한 줄을 그린다', () => {
  const text = renderResult(statusPayload, { command: ['rule', 'ls'], ...plain });
  const lines = text.split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], 'r1  on   request   set     A → 1');
  assert.equal(lines[1], 'r2  off  response  remove  B');
});

test('site ls 가 도메인마다 한 줄을 그린다', () => {
  assert.equal(renderResult(statusPayload, { command: ['site', 'ls'], ...plain }), 'a.com');
});

test('site ls 가 all-sites 를 모드로 말한다', () => {
  const payload = {
    ...statusPayload,
    scopingHosts: [],
    profile: { ...statusPayload.profile, filter: { domains: ['a.com'], allSites: true } },
  };
  assert.equal(
    renderResult(payload, { command: ['site', 'ls'], ...plain }),
    'all sites (1 saved site is not scoping anything while this mode is on)',
  );
});

test('state get 이 상태를 보기 좋게 찍는다', () => {
  const text = renderResult(statusPayload, { command: ['state', 'get'], ...plain });
  assert.equal(text, JSON.stringify(statusPayload.state, null, 2));
});

test('status 가 요약 넷을 그린다', () => {
  const text = renderResult(statusPayload, { command: ['status'], ...plain });
  assert.equal(text.includes('rules     2 total, 1 on'), true);
  assert.equal(text.includes('scope     a.com'), true);
  assert.equal(text.includes('headers   running'), true);
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd packages/headerlab && node --test
```
Expected: FAIL — 파서가 `status` 를 모르고, 표가 넷을 빠뜨렸고, 렌더가 없다

- [ ] **Step 3: 파서와 표에 넷을 더한다**

`lib/args.mjs` 의 `parse()` switch 에:

```js
    case 'status':
      return parseNullary(rest, 'status');
```
`parseSite` 에 `if (sub === 'ls') return parseNullary(rest, 'status', 'site ls');`
`parseRule` 에 `if (sub === 'ls') return parseNullary(rest, 'status', 'rule ls');`
`parseState` 의 `sub !== 'set'` 검사 앞에 `if (sub === 'get') return parseNullary(rest, 'status', 'state get');`

`parseNullary` 는 이미 `(args, cmd, display = cmd)` 서명을 갖고 있으므로
그대로 쓴다 — **넷이 같은 `cmd: 'status'` 를 내되 에러 메시지는 사람이 친
이름으로 나온다.**

`lib/commands.mjs` 에 네 항목을 더한다:

```js
  { path: ['status'], summary: 'what is installed, live, and configured', examples: ['headerlab status'] },
  { path: ['site', 'ls'], summary: 'list the sites the rules are scoped to', examples: ['headerlab site ls'] },
  { path: ['rule', 'ls'], summary: 'list the header rules', examples: ['headerlab rule ls'] },
  { path: ['state', 'get'], summary: 'print the entire stored state', examples: ['headerlab state get'] },
```

- [ ] **Step 4: 렌더를 더한다**

`lib/render.mjs` 의 `renderResult` 앞에 넣고 디스패치에 연결한다:

```js
function renderRuleList(payload, color) {
  const rules = payload.profile?.headers ?? [];
  if (rules.length === 0) return 'no rules yet';
  const width = {
    id: Math.max(...rules.map((r) => r.id.length)),
    target: Math.max(...rules.map((r) => r.target.length)),
    op: Math.max(...rules.map((r) => r.operation.length)),
  };
  const problems = new Map(payload.diagnostics.byRow);
  return rules
    .map((rule) => {
      const state = rule.enabled ? paint('on ', COLORS.green, color) : paint('off', COLORS.dim, color);
      const body = rule.operation === 'remove' ? rule.name : `${rule.name} → ${rule.value}`;
      const trouble = [...problems.entries()].find(([key]) => key.endsWith(rule.id));
      const suffix = trouble ? `  ${paint(trouble[1][0].message, COLORS.red, color)}` : '';
      return `${pad(rule.id, width.id)}  ${state}  ${pad(rule.target, width.target)}  ${pad(rule.operation, width.op)}  ${body}${suffix}`;
    })
    .join('\n');
}

function renderSiteList(payload) {
  if (payload.profile?.filter.allSites) {
    const saved = payload.profile.filter.domains.length;
    const noun = saved === 1 ? 'site is' : 'sites are';
    return `all sites (${saved} saved ${noun} not scoping anything while this mode is on)`;
  }
  const hosts = payload.scopingHosts;
  return hosts.length === 0 ? 'nothing in scope' : hosts.join('\n');
}

function renderStatus(payload, color) {
  const tally = payload.tally;
  const rules = tally === null ? 'none yet' : `${tally.total} total, ${tally.live} on`;
  const scope = payload.profile?.filter.allSites
    ? 'all sites'
    : payload.scopingHosts.length === 0
      ? paint('nothing in scope', COLORS.amber, color)
      : payload.scopingHosts.join(', ');
  const headers = payload.globalPause
    ? paint('paused', COLORS.amber, color)
    : paint('running', COLORS.green, color);

  const lines = [
    `headers   ${headers}`,
    `rules     ${rules}`,
    `scope     ${scope}`,
  ];
  if (payload.suppression !== null) {
    lines.push('', paint(`not applying: ${payload.suppression}`, COLORS.amber, color));
  }
  lines.push('', 'Location-specific detail: headerlab bridge status');
  return lines.join('\n');
}
```

`renderResult` 의 디스패치에 더한다:

```js
  if (key === 'rule ls') return renderRuleList(payload, color);
  if (key === 'site ls') return renderSiteList(payload);
  if (key === 'state get') return JSON.stringify(payload.state, null, 2);
  if (key === 'status') return renderStatus(payload, color);
```

- [ ] **Step 5: `status` 가 브릿지 없이도 답하게 한다**

`bin/headerlab.mjs` — 소켓으로 가기 전에 분기한다:

```js
  // `headerlab status` 는 종료 코드 표의 의도적 예외다. 브릿지가 없다는
  // 것은 이 명령에게 에러가 아니라 보고할 사실이므로, 커밋 없는 저장소의
  // `git status` 처럼 exit 0 으로 그것을 그린다. 다른 어떤 명령도 이
  // 예외를 갖지 않는다.
  if (command.cmd === 'status' && pathKey(commandPath) === 'status') {
    const paths = defaultInstallPaths({ userDataDir: null, browser: 'chrome' });
    const local = await bridgeStatus(paths);
    let remote = null;
    try {
      const target = await resolveTarget(socketDir(), bridgePid);
      remote = await sendCommand(target.socketPath, command);
    } catch {
      // 브릿지가 없다. local 만으로 답한다.
    }
    emitOk({ ...local, ...(remote?.ok ? remote : {}), live: remote?.ok === true }, commandPath);
    return;
  }
```

`renderStatus` 를 브릿지 없는 payload 에도 견디게 한다 — 위 구현이
`payload.tally` 를 `undefined` 로 받을 수 있으므로 `?? null` 을 넣는다:

```js
  const tally = payload.tally ?? null;
```
그리고 브릿지 상태 줄을 맨 위에 더한다:
```js
    `bridge    ${payload.live ? paint('live', COLORS.green, color) : paint('not running', COLORS.amber, color)}`,
```

`test/render.test.mjs` 의 `'status 가 요약 넷을 그린다'` 기대에 `bridge` 줄이
추가되므로, 그 테스트에 한 줄 더 assert 한다:
```js
  assert.equal(text.includes('bridge'), true);
```

- [ ] **Step 6: 통과를 확인한다**

```bash
cd packages/headerlab && node --test
node bin/headerlab.mjs status --json; echo "exit=$?"
```
Expected: 테스트 PASS · `status` 가 브릿지 없이 **exit 0**

- [ ] **Step 7: 커밋**

```bash
git add packages/headerlab/lib/ packages/headerlab/bin/ packages/headerlab/test/
git commit -m "feat: add status, rule ls, site ls and state get"
```

---

### Task 16: e2e — 실제 브릿지를 통과하는 읽기

**Files:**
- Modify: `tests/e2e/bridge.spec.ts`

**Interfaces:**
- Consumes: Task 13·14·15 전부
- Produces: 없음

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/e2e/bridge.spec.ts` 에 덧붙인다. 기존
`'a CLI command reaches storage through the bridge'` 테스트의 배선(호스트
설치, `--bridge <pid>`, `chrome.storage` 읽기)을 그대로 따른다.

```ts
test('a read command comes back through the bridge with what the popup would show', async ({
  context,
  extensionId,
}) => {
  // 먼저 쓴다 — 읽을 것이 있어야 읽기가 무언가를 증명한다.
  await runCli(['site', 'add', 'read-me.example.com']);

  const { stdout, code } = await runCli(['rule', 'ls', '--json']);
  expect(code).toBe(0);
  const payload = JSON.parse(stdout);

  // 부재를 먼저: 읽기가 상태를 바꾸지 않았다는 것.
  const stored = await readStoredState(context, extensionId);
  expect(stored.profiles[0].filter.domains).toEqual(['read-me.example.com']);

  // CLI 자신의 답이 아니라 확장이 실제로 들고 있는 것과 맞는지 본다.
  expect(payload.ok).toBe(true);
  expect(payload.scopingHosts).toEqual(['read-me.example.com']);
  expect(payload.state.profiles[0].filter.domains).toEqual(['read-me.example.com']);
});
```

`runCli` 와 `readStoredState` 는 그 파일의 기존 헬퍼 이름에 맞춘다 — 다르면
실제 이름을 쓴다.

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm test:e2e
```
Expected: FAIL (또는 Task 13–15 가 다 들어갔다면 바로 PASS — 그렇다면
`lib/bridge/port.ts` 의 읽기 분기를 한 줄 주석 처리해 빨간 것을 보고 되돌린다)

- [ ] **Step 3: 통과를 확인한다**

```bash
pnpm test:e2e
```
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add tests/e2e/bridge.spec.ts
git commit -m "test: drive a read command through a real bridge"
```

---

### Task 17: 문서와 릴리즈

**Files:**
- Modify: `packages/headerlab/package.json` (`version`, `bugs`)
- Modify: `packages/headerlab/README.md`
- Modify: `README.md`, `docs/README.ko.md`, `docs/README.ja.md`, `docs/README.zh.md`, `docs/README.es.md`
- Modify: `packages/plugin/skills/headerlab/SKILL.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: 전부
- Produces: 없음

- [ ] **Step 1: `package.json` 에 `bugs` 를 더한다**

`homepage` 아래에 넣는다 (oxfmt 가 키를 정렬하므로 위치는 신경 쓰지 않아도 된다):

```json
  "bugs": "https://github.com/say8425/headerlab/issues",
```

`version` 은 손대지 않는다 — release-please 가 conventional commit 에서
0.2.0 을 계산한다.

- [ ] **Step 2: `SKILL.md` 를 고친다**

세 곳이다.

1. `## What this is` 의 출력 문단을 바꾼다:

```markdown
**Pass `--json` on every invocation.** Output is one JSON object on stdout,
success or failure. That is already what you get when the CLI is not attached
to a terminal, but say it explicitly rather than depending on the detection —
a contract that rests on how you happened to be invoked breaks silently on
the day that changes.

**The exit code names the failure class**, so branch on it rather than
parsing: `0` success · `2` the CLI refused your input · `3` no bridge to talk
to · `4` connected but the exchange failed · `1` the extension refused the
request.
```

2. `## Commands` 표에 네 줄을 더하고, `state set` 줄에 `--force` 를 적는다:

```markdown
| `headerlab status --json` | What is installed, live and configured. **Never fails with `bridge-off`** — it reports that as a fact and exits 0. |
| `headerlab rule ls --json` | The header rules, with any problem the compiler found. |
| `headerlab site ls --json` | The sites the rules are scoped to. |
| `headerlab state get --json` | The entire stored state, under `.state`. |
```

3. `There is currently no dedicated read-only command.` 로 시작하는 문단을
지우고 그 자리에 넣는다:

```markdown
Reads no longer require a write. `status`, `rule ls`, `site ls` and
`state get` all answer from the same query and change nothing. Round-tripping
the whole state is one pipe:
`headerlab state get --json | jq .state | headerlab state set - --force`.
```

`state set` 줄에 덧붙인다: *Requires `--force` when not on a terminal, which
is always the case here — it is a full overwrite that cannot be undone.*

- [ ] **Step 3: `packages/headerlab/README.md` 에 uninstall 절을 만든다**

`## License` 앞에 넣는다:

```markdown
## Uninstalling

```bash
headerlab bridge uninstall   # remove the native-messaging host manifest first
npm uninstall -g headerlab
```

Removing the package without the first line leaves a manifest pointing at a
launcher that is no longer there. Nothing in Chrome will say so — `headerlab
bridge status` is the only thing that reads the launcher back, and it reports
`entryMissing`.
```

`## Commands` 절의 명령 목록에 읽기 넷을 더하고, 첫 문단의
*Every reply is one JSON object on stdout* 를 바꾼다:

```markdown
On a terminal it prints for people; piped or with `--json` it prints one JSON
object, success or failure. The exit code names the failure class: `2` your
input, `3` no bridge, `4` transport, `1` refused.
```

- [ ] **Step 4: 다섯 README 의 Agent bridge 절을 맞춘다**

루트 `README.md` 와 `docs/README.{ko,ja,zh,es}.md` 의 Agent bridge 절에서,
명령 목록에 읽기 넷을 더하고 종료 코드 표 한 줄을 더한다. **다섯 파일의
실행 가능한 명령은 바이트 동일해야 한다** — 산문만 번역되고 명령은 번역되지
않는다. 다 고친 뒤 확인한다:

```bash
for f in README.md docs/README.ko.md docs/README.ja.md docs/README.zh.md docs/README.es.md; do
  printf '%s: ' "$f"; grep -c 'headerlab ' "$f"
done
```
Expected: 다섯 숫자가 전부 같다

- [ ] **Step 5: `CLAUDE.md` 를 갱신한다**

`## Known gaps` 의 마지막 항목(`headerlab status`, `diagnostics`,
`state get`, `rule ls` are not built)을 고친다 — 넷 중 셋이 생겼고
`diagnostics` 는 만들지 않기로 한 것이므로:

```markdown
- **`headerlab diagnostics` is not built and will not be.** `status` carries
  the same payload; a second name for one query is not a feature. `state
  snapshots`/`state restore <id>`, which design spec §2 and §3 promise, do
  not exist either — `state set` passes zod validation and nothing else, and
  now also requires `--force`. The README makes no such promise, so nothing
  false has shipped publicly.
```

`## Testing` 절에 한 문단 더한다:

```markdown
**The CLI's presentation layer is pure and its output adapter is not.**
`lib/render.mjs`, `lib/help.mjs`, `lib/commands.mjs`, `lib/suggest.mjs` and
`lib/exit.mjs` take their inputs as arguments and return strings, so the
human-facing output is tested without spawning a process. `lib/output.mjs`
is the one file that reads `process.stdout.isTTY` and `process.env`, and
`test/process.test.mjs` covers the three things that only appear when a real
process runs: a closed pipe, SIGINT, and `state set -` on a terminal.
```

- [ ] **Step 6: 전체 검사를 돌린다**

```bash
cd /Users/penguin/dev/headerlab && pnpm check:all && pnpm test:e2e
```
Expected: 전부 PASS

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "docs: document the redesigned CLI across the READMEs and the skill"
```

---

## 자체 검토

**스펙 대응.** §1 → Task 2·8·9·10 (측정된 결함 여섯). §2.1–2.3 → Task 3·6·7.
§2.4 → Task 12. §2.5–2.6 → Task 8. §2.7 → Task 5. §3.1 → Task 15.
§3.2 → Task 2·9·10·11. §3.3 → Task 2. §3.4 → Task 5. §4 → Task 13·14.
§5 → Task 1·4·7. §6 → Task 5·6. §7 → Task 9·10·11. §8 → 만들지 않는 것이므로
태스크 없음. §9 → 파일 구조 표. §10 → 각 태스크의 테스트. §11 → Task 17.
§12 → PR 본문.

**빠진 것 하나를 채웠다.** 스펙 §5.3 은 `headerlab site` 같은 *틀린* 호출이
그 그룹의 usage 를 내야 한다고 적었는데, 초안에는 그 태스크가 없었다.
Task 7 의 `withSuggestion` 이 오타만 다루고 usage 줄은 안 붙인다. **Task 7
Step 3 에 한 줄을 더한다:** `emitFail` 이 `human` 모드이고 `error.code` 가
`invalid-args` 일 때, `findCommand` 로 찾은 항목이 있으면 `usageLine(entry)`
를 메시지 아래 한 줄 덧붙인다. 없으면 덧붙이지 않는다.

**타입 일관성.** `Globals` 는 Task 2 가 정의하고 6·7·9·12 가 읽는다 — 필드
이름 여덟 개가 전부 일치한다. `StatusPayload` 는 Task 13 이 정의하고 15 가
그린다 — `profile`·`tally`·`scopingHosts`·`diagnostics.byRow`·`globalPause`·
`suppression` 이 양쪽에서 같은 이름이다. `renderResult(payload, {command,
color})` 의 서명은 Task 5 가 정하고 11·15 가 확장한다.
`sendCommand` 의 세 번째 인자는 Task 12 만 바꾸며 기본값이 있어 기존 호출부는
안 깨진다.

**자리표시자.** 없음. Task 14 Step 1 이 테스트 본문 대신 "검사할 세 가지" 를
적은 것은 유일한 예외이며, 이유는 그 파일의 fake-browser setup 배선이
저장소마다 다르고 구현자가 옆 테스트를 보고 맞춰야 하기 때문이다 — 무엇을
검사할지는 명시했고, 어떤 assert 를 먼저 둘지도 명시했다.

---

## 실행

**Plan complete and saved to `docs/superpowers/plans/2026-08-15-cli-clig-redesign.md`.**
