# CLI 를 npm 으로 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm i -g headerlab` 이 동작하게 만든다. 사람이 저장소를 클론하지 않고 CLI 를 설치해
쓸 수 있어야 한다.

**Architecture:** `packages/cli` 와 `packages/host` 를 `packages/headerlab` 하나로 합쳐
발행한다. `bridge install` 이 가리킬 호스트 엔트리가 같은 tarball 안에 있어야 하기 때문이고,
그것이 교차 패키지 임포트 문제도 기계장치가 아니라 구조로 없앤다. 발행은 release-please 의
`release_created` 분기에서 `--provenance` 와 함께 일어난다.

**Tech Stack:** Node 24 내장만 · npm(CI 의 Node 에 딸려 옴) · release-please 17.6.0

## 설계 문서

`docs/superpowers/specs/2026-08-14-cli-npm-publication-design.md` (커밋 `1860302`).

## 이동 전 기준선 — 합격 조건이다

**직접 잰 값이다.** 이동 후 이 숫자들이 유지되어야 한다. 줄었다면 어떤 스위트가 경로 때문에
안 도는 것이지 테스트가 사라진 것이 아니다.

| | |
|---|---|
| 루트 vitest | **817** tests, **38** files |
| `packages/host` | **59** |
| `packages/cli` | **81** |
| 합친 패키지가 되어야 할 값 | **140** |
| e2e | **16** |

## Global Constraints

- **새 의존성 0개.** 합치는 것은 파일 이동이지 새 도구가 아니다.
- **`pnpm` 이 이 기계에서 깨져 있다.** 래퍼 디렉터리를 PATH **앞**에 둔다:
  `PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm <script>`.
  `pnpm check` 가 자기를 재귀 호출하므로 앞이어야 한다. **`pnpm install` 은 돌리지 않는다.**
- **`pnpm test` 를 쓴다. 맨손 `vitest run` 금지.** 필터는 인자를 그냥 준다: `pnpm test outbound`.
- **`node --test packages/<x>` 는 그 경로를 파일로 읽는다.** 패키지 안에서 돌린다.
- **파일 이동은 `git mv` 로 한다.** 복사 후 삭제하면 이력이 끊긴다.
- **커밋은 영어**, `<type>: <description>`. **`docs/` 산문은 한국어, 코드 주석은 영어.**
- **변이 검증은 커밋 후에.**
- **모든 단언에 대해 묻는다: 어떤 잘못된 구현이 이걸 통과하는가?** 이 저장소는 "실패할 수 없는
  단언"을 반복 결함으로 이름 붙였고, 3차에서 변이 검증이 셋을 더 잡았다.
- **절대 `npm publish` 를 손으로 돌리지 않는다.** `--dry-run` 만. 진짜 발행은 릴리즈 PR 이
  병합될 때 CI 가 한다.

---

### Task 1: 두 패키지를 `packages/headerlab` 으로 합친다

**Files:**
- Move: `packages/cli/**` → `packages/headerlab/**`
- Move: `packages/host/lib/*.mjs`, `packages/host/bin/*.mjs`, `packages/host/test/*.mjs`,
  `packages/host/lib/*.d.mts` → `packages/headerlab/` 의 같은 하위 디렉터리
- Modify: `packages/headerlab/package.json` (합친 것)
- Delete: `packages/cli/package.json`, `packages/host/package.json` (하나로 대체)
- Modify: `pnpm-workspace.yaml`

**Interfaces:**
- Produces: 패키지 이름 `headerlab`, `bin` 은 `{"headerlab": "bin/headerlab.mjs"}` 하나.
  모든 `../../host/lib/X.mjs` 임포트가 `../lib/X.mjs` 또는 `./X.mjs` 가 된다.

- [ ] **Step 1: 옮긴다**

```bash
git mv packages/cli packages/headerlab
git mv packages/host/lib/framing.mjs   packages/headerlab/lib/
git mv packages/host/lib/host.mjs      packages/headerlab/lib/
git mv packages/host/lib/socket.mjs    packages/headerlab/lib/
git mv packages/host/lib/manifest.mjs  packages/headerlab/lib/
git mv packages/host/lib/socket.d.mts   packages/headerlab/lib/
git mv packages/host/lib/manifest.d.mts packages/headerlab/lib/
git mv packages/host/bin/headerlab-host.mjs packages/headerlab/bin/
for f in packages/host/test/*.mjs; do git mv "$f" packages/headerlab/test/; done
git rm packages/host/package.json
rmdir packages/host/lib packages/host/bin packages/host/test packages/host 2>/dev/null || true
```

- [ ] **Step 2: package.json 을 합친다**

`packages/headerlab/package.json` 을 통째로 이것으로 바꾼다:

```json
{
  "name": "headerlab",
  "version": "0.0.0",
  "description": "Drive the HeaderLab Chrome extension's header rules from a terminal.",
  "license": "Apache-2.0",
  "homepage": "https://github.com/say8425/headerlab",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/say8425/headerlab.git",
    "directory": "packages/headerlab"
  },
  "keywords": ["headerlab", "http-headers", "chrome-extension", "native-messaging"],
  "bin": {
    "headerlab": "bin/headerlab.mjs"
  },
  "files": [
    "bin",
    "lib"
  ],
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "test": "node --test"
  }
}
```

`private: true` 가 **없어진 것이 이 파일에서 가장 중요한 한 줄**이다. 그것이 npm 이
`EPRIVATE` 로 거절하던 안전장치였고, 이제 발행이 의도된 동작이다.

`bin` 에 `headerlab-host` 를 넣지 않는다 — Chrome 이 절대 경로로 exec 하는 것이지 사람이
부르는 것이 아니고, PATH 에 올리면 사람이 부를 수 있는 것처럼 보인다.

- [ ] **Step 3: 임포트를 고친다**

`packages/headerlab` 안에서 `../../host/lib/` 를 찾아 전부 고친다:

```bash
grep -rn "\.\./\.\./host/lib/" packages/headerlab/
```

- `lib/*.mjs` 안에서는 `'./X.mjs'`
- `bin/*.mjs` 안에서는 `'../lib/X.mjs'`
- `test/*.mjs` 안에서는 `'../lib/X.mjs'`

`packages/headerlab/lib/install.mjs` 의 `defaultInstallPaths()` 가 엔트리를 잡는 줄도
확인한다 — `path.resolve(here, '../../host/bin/headerlab-host.mjs')` 가
`path.resolve(here, '../bin/headerlab-host.mjs')` 가 된다. **이 한 줄이 틀리면 인스톨러가
존재하지 않는 파일을 가리키고, Chrome 은 그 실패를 매니페스트 거부와 같은 문구로 보고한다.**

- [ ] **Step 4: 워크스페이스를 고친다**

`pnpm-workspace.yaml` 의 `packages:` 블록을 둘로 줄인다. **글롭으로 바꾸지 않는다** — 그
파일의 주석이 이유를 적어두었다.

```yaml
packages:
  - packages/headerlab
  - packages/plugin
```

- [ ] **Step 5: 합친 스위트가 도는지 확인한다**

```bash
cd packages/headerlab && node --test test/*.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail) "
```

**기대: tests 140, pass 140, fail 0.** 140 이 아니면 멈추고 보고한다 — 어떤 파일이 안 옮겨졌거나
임포트가 깨져 스위트 하나가 통째로 빠진 것이다.

돌린 뒤 좀비를 확인한다: `pgrep -f headerlab-host || echo none`, 그리고
`pkill -9 -f headerlab-host || true`. 이 스위트는 진짜 호스트 프로세스를 띄운다.

- [ ] **Step 6: 커밋**

```bash
git add -A packages pnpm-workspace.yaml
git commit -m "refactor: merge the host into the CLI as one publishable package"
```

---

### Task 2: 경로로 대상을 찾는 루트 가드들

**Files:**
- Modify: `tests/unit/outbound.test.ts`
- Modify: `tests/unit/workspace.test.ts`
- Modify: `tests/unit/bridgeName.test.ts`
- Modify: `tests/e2e/bridge-fixtures.ts`, `tests/e2e/bridge.spec.ts` (임포트 경로)
- Modify: `packages/headerlab/lib/install.d.mts` 가 있다면 그 안의 참조

**여기가 이 작업에서 가장 위험한 부분이다.** 경로가 바뀌면 경로로 대상을 찾는 가드는 조용히
아무것도 검사하지 않게 된다.

- [ ] **Step 1: 무엇이 깨졌는지 먼저 본다**

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm check 2>&1 | tail -40
```

**출력을 보고서에 적는다.** 무엇이 빨간지가 이 태스크의 작업 목록이다.

- [ ] **Step 2: `outbound.test.ts` 의 글롭 — 조용히 죽는 유일한 항목**

```ts
const SOURCES = globSync('packages/headerlab/**/*.mjs');
```

그리고 그 위 독블록에 한 문장을 더한다. 이 파일은 이미 자기 사각지대를 적어두는 파일이므로
같은 자리에 적는다:

```ts
 * **이 글롭은 경로에 묶여 있다.** 패키지가 옮겨지면 여기가 빈 목록이 되고 가드 전체가
 * 조용히 통과한다 — 아래 첫 테스트가 그것을 잡으라고 있다. 2026-08-14 에
 * `packages/{cli,host}` 가 `packages/headerlab` 으로 합쳐지면서 실제로 한 번 걸렸다.
```

(주석은 영어로 쓴다 — 위 문장은 뜻이고, 그대로 옮기지 말 것.)

**그 파일의 첫 테스트가 `SOURCES.length > 0` 을 보므로 빈 글롭은 잡힌다.** 그 테스트가 왜
있는지가 지금 증명된 셈이니, 고친 뒤 일부러 글롭을 `packages/nope/**` 로 바꿔 그것이 빨간지
확인하고 되돌린다.

- [ ] **Step 3: `workspace.test.ts` — 셋에서 둘로**

정확값 고정을 유지한다. 글롭으로 바꾸지 않는다.

```ts
expect(declaredPackages()).toEqual(['packages/headerlab', 'packages/plugin']);
```

그 파일이 CI 의 `packages` 잡이 도는지도 보는데, `pnpm test:packages` 는 `pnpm -r test` 라
워크스페이스가 해석하므로 그 단언은 그대로 둔다.

- [ ] **Step 4: 나머지 임포트 경로**

`tests/unit/bridgeName.test.ts` 는 `packages/host/lib/manifest.mjs` 를 임포트한다 →
`packages/headerlab/lib/manifest.mjs`. 그 파일이 `lib/bridge/port.ts` 의 소스에서 찾는
문자열은 안 바뀐다.

e2e 픽스처가 `packages/cli/lib/install.mjs` 와 `packages/host/lib/socket.mjs`,
`packages/host/lib/manifest.mjs` 를 임포트한다 → 전부 `packages/headerlab/lib/`.

- [ ] **Step 5: 초록을 확인한다**

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm check:all
```

**기대: 루트 vitest 817 tests / 38 files, 패키지 140.** 개수가 다르면 멈추고 보고한다.

- [ ] **Step 6: e2e**

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm test:e2e
```

**기대: 16/16.** 브리지 e2e 가 인스톨러를 직접 임포트하므로 경로 이동에 정면으로 걸린다.

끝나고: `pgrep -f headerlab-host || echo none`, `ls -A ~/.headerlab/bin`,
`ls -A "$(/usr/bin/getconf DARWIN_USER_TEMP_DIR)headerlab"` — 셋 다 비어 있어야 한다.

- [ ] **Step 7: 커밋과 변이 검증**

```bash
git add -A tests
git commit -m "test: point the path-bound guards at the merged package"
```

커밋 후: `outbound.test.ts` 의 글롭을 없는 경로로 바꿔 첫 테스트가 빨간지 확인하고 되돌린다.
**어느 테스트가 이름으로 빨개졌는지 보고한다.**

---

### Task 3: 릴리즈 설정과 플러그인 심

**Files:**
- Modify: `release-please-config.json`
- Modify: `.release-please-manifest.json`
- Modify: `packages/plugin/bin/headerlab`
- Modify: `tests/unit/workspace.test.ts` (릴리즈 가드가 경로를 본다면)

- [ ] **Step 1: release-please 의 키를 옮긴다**

`release-please-config.json` 의 `packages/cli` 항목이 `packages/headerlab` 이 된다.
`component` 는 `cli` 그대로 둔다 — 태그가 `cli-v0.1.0` 이고, 그것은 사용자가 보는 이름이지
디렉터리 이름이 아니다. `extra-files` 의 두 플러그인 매니페스트 경로는 안 바뀐다.

`.release-please-manifest.json` 의 `"packages/cli": "0.0.0"` 키도 같이 옮긴다.

- [ ] **Step 2: 플러그인 심의 경로**

`packages/plugin/bin/headerlab` 의 마지막 줄:

```sh
exec node "$dir/../../headerlab/bin/headerlab.mjs" "$@"
```

그 위 주석의 "packages/cli sits beside packages/plugin" 도 새 이름으로 고친다.

**심을 없애지 않는다.** CLI 가 npm 에 있다고 플러그인 사용자가 전역 설치했으리라 가정할 수
없고, 전역 설치가 있으면 PATH 에서 그쪽이 먼저 잡힌다. 둘은 배타적이지 않다 — 그 이유를
주석에 한 줄로 적는다.

- [ ] **Step 3: 워크스페이스 가드가 릴리즈 설정도 보는지 확인**

`tests/unit/workspace.test.ts` 를 읽고, release-please 설정의 패키지 키를 고정하는 단언이
있으면 같이 고친다. **없으면 하나 더한다** — 설정의 키와 실제 디렉터리가 어긋나면 릴리즈가
빈 채로 나가고, 그것이 이 저장소가 §6.1 에서 이름 붙인 실패다.

```ts
it('names the package release-please releases, and it is a directory that exists', () => {
  const config = JSON.parse(readFileSync('release-please-config.json', 'utf8'));
  const paths = Object.keys(config.packages).filter((p) => p !== '.');
  expect(paths).toEqual(['packages/headerlab']);
  for (const p of paths) expect(existsSync(p)).toBe(true);
});
```

`existsSync` 가 이 단언의 이빨이다 — 키만 고정하면 디렉터리가 사라져도 통과한다.

- [ ] **Step 4: 검사와 커밋**

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm check
```

```bash
git add release-please-config.json .release-please-manifest.json packages/plugin tests
git commit -m "chore: point the release config and the plugin shim at the merged package"
```

---

### Task 4: 발행 스텝과 dry-run 검증

**Files:**
- Modify: `.github/workflows/release-please.yml`

`NPM_TOKEN` 은 저장소 시크릿에 이미 있다(2026-08-13 등록 확인). **값을 읽지 않는다** —
워크플로가 `secrets.NPM_TOKEN` 으로 참조만 한다.

- [ ] **Step 1: tarball 에 무엇이 들어가는지 눈으로 본다**

```bash
cd packages/headerlab && npm pack --dry-run
```

**목록을 보고서에 그대로 적는다.** `bin/` 과 `lib/` 만 있어야 한다. `test/` 가 하나라도
보이면 멈추고 보고한다 — `files` 를 믿는 것과 결과를 보는 것은 다르다.

- [ ] **Step 2: 이름이 받아들여지는지 본다**

```bash
cd packages/headerlab && npm publish --dry-run 2>&1 | tail -20
```

아무것도 올리지 않는다. **이름 거절이나 인증 오류가 나오면 멈추고 보고한다** — npm 은 기존
이름과 너무 비슷한 이름을 거절하기도 하고, 그 판정은 시도해야 나온다. 인증 오류는 이 단계에서
정상이다(로컬에 토큰이 없다); 이름 관련 오류만이 멈출 이유다.

- [ ] **Step 3: 발행 스텝을 단다**

`release-please.yml` 의 `permissions` 에 한 줄:

```yaml
permissions:
  contents: write
  pull-requests: write
  # npm's provenance attestation is signed with the workflow's OIDC token, so
  # the package page can show which commit and which workflow produced the
  # tarball. For an extension that exists because a hidden tracker was found in
  # its predecessor, that is worth one permission.
  id-token: write
```

그리고 `gh release upload` 스텝 **뒤에** 두 스텝을 더한다:

```yaml
      - uses: actions/setup-node@v6
        if: ${{ steps.release.outputs.release_created }}
        with:
          # Without a registry-url, setup-node writes no .npmrc and
          # NODE_AUTH_TOKEN is never consulted — the publish fails
          # authentication with a token that is present and correct.
          registry-url: https://registry.npmjs.org

      # `npm`, not `pnpm`: pnpm is broken on the developer's machine (CLAUDE.md)
      # and publishing only ever happens here, where npm ships with the Node
      # setup-node just installed. No `--access` flag: `headerlab` is unscoped
      # and therefore public by default.
      - run: npm publish --provenance
        if: ${{ steps.release.outputs.release_created }}
        working-directory: packages/headerlab
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**`./.github/actions/setup` 가 이미 Node 를 깔지만 `registry-url` 없이 깐다.** 그래서
`setup-node` 를 한 번 더 부르는 것이지 중복이 아니다 — 그 이유를 주석에 적는다.

- [ ] **Step 4: 워크플로가 파싱되는지 확인**

```bash
gh workflow view release-please.yml 2>&1 | head -5
```

또는 YAML 을 파싱해 본다. **실행하지 않는다** — 이 워크플로는 `main` 푸시에서만 돈다.

- [ ] **Step 5: 커밋**

```bash
git add .github/workflows/release-please.yml
git commit -m "ci: publish the CLI to npm with provenance on release"
```

---

### Task 5: 문서

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-08-11-agent-bridge-design.md`

- [ ] **Step 1: README**

Install 절에 npm 설치를 **첫 번째**로 넣는다 — 사람이 쓰는 방법이 저장소를 클론하는 것보다
앞에 와야 한다:

```bash
npm i -g headerlab
```

Agent bridge 절의 켜는 순서에서 `node packages/cli/bin/headerlab.mjs` 를 `headerlab` 으로
바꾼다. 플러그인 설치도 여전히 유효하다는 것을 한 줄로 적는다 — 전역 설치가 있으면 PATH 에서
그쪽이 잡히고, 없으면 심이 탄다.

- [ ] **Step 2: CLAUDE.md**

Architecture 트리의 `packages/` 줄을 새 모양으로. 그리고 Non-negotiables 나 그에 준하는 자리에
한 문단:

> **`packages/headerlab` 은 발행된다. 확장과 플러그인은 아니다.** 그 패키지에는
> `private: true` 가 없고, 그것이 npm 이 `EPRIVATE` 로 거절하던 안전장치였다. tarball 에
> 들어가는 것은 `files` 가 정하고, **`npm pack --dry-run` 으로 눈으로 확인한다** — `files` 를
> 믿는 것과 결과를 보는 것은 다르다. 발행은 CI 에서만 일어나고 손으로 돌리지 않는다.

그리고 왜 한 패키지인지 한 줄: `bridge install` 이 가리킬 호스트 엔트리가 같은 tarball 안에
있어야 하기 때문이지 정리가 아니다.

- [ ] **Step 3: 설계 문서의 Q5 를 닫는다**

§10 의 미결 표에서 Q5 를 **답함**으로 바꾸고 새 spec 을 가리킨다. §6.5 의 "미결이다" 문장도
사실에 맞춘다 — 원문을 지우지 말고 무엇이 결정됐는지 옆에 적는다. 이 저장소의 문서는
기록이다.

- [ ] **Step 4: 검사와 커밋**

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm check:all
```

```bash
git add README.md CLAUDE.md docs/
git commit -m "docs: record that the CLI ships on npm as headerlab"
```

---

## 끝나면

`pnpm check:all` 과 `pnpm test:e2e` 초록, 그리고 **개수가 기준선과 같을 것** — 817/38, 140,
16/16.

실제 발행은 이 작업이 아니다. 릴리즈 PR 이 `main` 에 병합될 때 CI 가 한다. 그때
`headerlab` 이 npm 에 처음 서고, 패키지 페이지에 provenance 배지가 붙는다.
