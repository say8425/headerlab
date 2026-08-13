# HeaderLab — CLI 를 npm 으로 발행하기

2026-08-14

## 왜

지금 `headerlab` 을 쓰는 방법은 둘뿐이다. 저장소를 클론해 `node
packages/cli/bin/headerlab.mjs` 를 부르거나, 플러그인 마켓플레이스로 설치해 심을 타거나.
둘 다 **에이전트를 위한 경로**다.

소유자 결정: **사람이 직접 설치해서 쓸 수 있어야 한다.** `npm i -g headerlab` 이 그 문장의
전부다. 스킬은 지금처럼 플러그인으로 계속 간다 — 둘은 배포 경로가 다르지 그중 하나가 다른
하나를 대신하지 않는다.

이것으로 설계 문서 §10 의 **Q5 가 닫힌다.** 그 항목은 "CLI 를 npm 에 올리는가, 어느
레지스트리로"였고 프록시 문제 때문에 미뤄져 있었다.

## 결정된 것

| 축 | 결정 | 근거 |
|---|---|---|
| 발행 단위 | **한 패키지 `headerlab`** | `bridge install` 이 가리킬 호스트 엔트리가 같은 tarball 안에 있어야 한다 |
| 이름 | 스코프 없는 `headerlab` | 비어 있음(확인). 스코프도 npm 조직도 필요 없다 |
| 소스 배치 | `packages/cli` 와 `packages/host` 를 `packages/headerlab` 으로 합친다 | 교차 패키지 임포트를 기계장치가 아니라 구조로 없앤다 |
| 출처 증명 | `--provenance` | 숨은 트래커 때문에 존재하는 제품이 tarball 의 출처를 증명할 수 있다 |
| 플러그인 | `private: true` 유지 | 마켓플레이스로 간다. npm 은 경로가 아니다 |
| 확장 | `private: true` 유지 | 웹스토어로 간다 |

---

## 1. 왜 두 패키지가 아닌가

`packages/cli` 는 `packages/host` 의 세 파일을 쓴다 — `socket.mjs`, `framing.mjs`,
`manifest.mjs`. 그중 **`socket.mjs` 는 중복될 수 없다.** 그 파일의 독블록이 이유를 적어두었다:
호스트는 Chrome 의 환경을, CLI 는 터미널의 환경을 물려받으므로, 둘이 서로 다른 디렉터리를
해석하면 **아무것도 실패하지 않은 채** 브리지가 없는 것처럼 보인다. 한 정의여야 한다.

그러나 임포트는 진짜 매듭이 아니다. **`bridge install` 은 호스트 엔트리 파일이 디스크에
있어야 런처가 그것을 가리킬 수 있다.** `defaultInstallPaths()` 가 `entryPath` 를
`../../host/bin/headerlab-host.mjs` 로 잡고, 인스톨러는 그 절대 경로를 `/bin/sh` 런처에 박아
넣는다. CLI 만 발행하면 사용자 기계에 그 파일이 없고, 런처는 존재하지 않는 것을 가리키며,
Chrome 은 그 실패를 **매니페스트 거부·ID 불일치와 똑같은 문구**로 보고한다.

**CLI 는 자기가 배포하지 않는 호스트를 설치할 수 없다.**

두 패키지로 나눠 `@headerlab/cli` 가 `@headerlab/host` 를 의존하게 하면 동작은 한다. 대가는
npm 조직, 함께 움직여야 하는 두 버전, `import.meta.resolve` 로 바뀌는 엔트리 경로, 그리고
**아무도 단독으로 설치하지 않을 패키지 하나**가 npm 에 서는 것이다. 한 패키지는 그 넷을
전부 없앤다.

### 1.1 `manifest.mjs` 는 원래 자리를 잘못 잡았다

`packages/host/lib/manifest.mjs` 를 호스트는 쓰지 않는다 — 소비자는 `packages/cli` 뿐이고,
`packages/host` 안에서 그것을 임포트하는 것은 자기 테스트 하나다. 호스트 매니페스트를 *쓰는*
쪽은 인스톨러이니 당연하다. 이번 이동이 그것도 제자리로 돌린다.

---

## 2. 이동

```
packages/cli/    ─┐
                  ├─→  packages/headerlab/
packages/host/   ─┘
```

```
packages/headerlab/
  bin/headerlab.mjs         사람과 에이전트가 부르는 것
  bin/headerlab-host.mjs    Chrome 이 부르는 것
  lib/  args.mjs bridge.mjs install.mjs        (CLI)
        framing.mjs host.mjs socket.mjs        (호스트)
        manifest.mjs                            (인스톨러가 쓰는 매니페스트 서술)
  test/ 두 스위트가 합쳐진 것
```

**`bin` 은 하나만 노출한다.** `package.json` 의 `bin` 은 `{"headerlab": "bin/headerlab.mjs"}`
그대로다. `headerlab-host` 는 PATH 에 오르지 않는다 — Chrome 이 절대 경로로 exec 하는
것이지 사람이 부르는 것이 아니고, PATH 에 올리면 사람이 부를 수 있는 것처럼 보인다.

**의존성은 여전히 0 개다.** 합치는 것은 파일 이동이지 새 도구가 아니다.

---

## 3. 함께 움직여야 하는 가드들 — 이 작업에서 가장 위험한 부분

경로가 바뀌면 **경로로 대상을 찾는 가드는 조용히 아무것도 검사하지 않게 된다.** 이 저장소가
"실패할 수 없는 단언"이라 이름 붙인 결함의 경로 판본이고, 이번 이동은 그것을 여섯 군데에서
동시에 만든다.

| 무엇 | 지금 | 안 고치면 |
|---|---|---|
| `tests/unit/outbound.test.ts` | `packages/{cli,host}/**/*.mjs` 를 글롭 | 빈 글롭 — 아웃바운드 가드가 통째로 죽는다 |
| `tests/unit/workspace.test.ts` | 정확히 세 패키지를 고정 | 실패한다(다행이다) |
| `tests/unit/bridgeName.test.ts` | `packages/host/lib/manifest.mjs` 를 임포트 | 타입/해석 실패 |
| `.d.mts` 셋 | `packages/host/lib/`, `packages/cli/lib/` | 임포트 실패 |
| `pnpm-workspace.yaml` | 세 항목을 이름으로 | 패키지가 워크스페이스 밖 |
| `.github/workflows/ci.yml` | `packages` 잡 | 스위트가 안 돈다 |
| `release-please-config.json`·매니페스트 | 키가 `packages/cli` | 릴리즈가 빈 채로 나간다 |

`outbound.test.ts` 가 유일하게 **조용히** 죽는 항목이다. 그 파일에 이미 "빈 글롭은 공허하게
통과한다"를 잡는 테스트가 있으므로 실제로는 잡히지만, 그것이 잡아준다는 사실 자체가 이 표를
적어두는 이유다 — 다음 이동에는 그런 짝이 없을 수 있다.

**워크스페이스 가드는 셋에서 둘로 줄되, 이름으로 계속 고정한다.** 글롭으로 바꾸지 않는다.
`pnpm-workspace.yaml` 이 패키지를 글롭하지 않는 이유가 그대로 유효하다 — 릴리즈 표면에
디렉터리가 하나 늘면 리뷰어가 보는 diff 여야지 조용히 매칭되는 것이면 안 된다.

---

## 4. 발행

### 4.1 워크플로

`release-please.yml` 의 `release_created` 분기에 붙는다. 그 잡은 이미 `contents: write` 를
갖고 있고, 여기에 `id-token: write` 가 더해진다.

```yaml
- uses: actions/setup-node@v6
  with:
    registry-url: https://registry.npmjs.org
- run: npm publish --provenance
  working-directory: packages/headerlab
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

세 가지가 실측 대신 근거로 서 있고 각각 이유가 있다.

- **`--access` 플래그가 없다.** 스코프 없는 이름은 기본이 public 이다. 스코프 패키지였다면
  `--access public` 이 필수였을 것이고, 그것이 스코프를 피한 부수적 이득이다.
- **`registry-url` 이 있어야 `NODE_AUTH_TOKEN` 이 붙는다.** setup-node 가 그 값을 보고
  `.npmrc` 를 쓴다. 없으면 토큰이 있어도 인증되지 않는다.
- **`npm publish` 이지 `pnpm publish` 가 아니다.** 이 저장소의 pnpm 은 로컬에서 깨져 있고
  (CLAUDE.md), 발행은 CI 에서만 일어난다. npm 은 CI 의 Node 에 딸려 온다.

### 4.2 `--provenance`

npm 이 GitHub Actions 의 OIDC 토큰으로 "이 tarball 은 이 저장소의 이 커밋에서 이 워크플로가
만들었다"는 서명된 증명을 붙인다. 패키지 페이지에 배지로 뜨고 `npm audit signatures` 로
검증된다.

이 제품은 숨은 트래커가 발견돼 스토어에서 내려간 확장의 대체재다. **"이 바이너리가 이
소스에서 나왔다"를 제3자가 확인할 수 있다는 것은 이 저장소에서 장식이 아니다.** README 의
"no network primitives" 주장이 빌드를 읽어 확인 가능하게 쓰인 것과 같은 종류의 선택이다.

### 4.3 tarball 에 무엇이 들어가는가

`files: ["bin", "lib"]`. 테스트는 안 들어간다. **발행 전에 `npm pack --dry-run` 으로 목록을
눈으로 확인한다** — `files` 를 믿는 것과 결과를 보는 것은 다르다.

---

## 5. 플러그인 심

`packages/plugin/bin/headerlab` 이 `../../cli/bin/headerlab.mjs` 를 형제로 exec 한다. 경로가
`../../headerlab/bin/headerlab.mjs` 로 바뀐다.

**심을 없애지 않는다.** CLI 가 npm 에 있다고 해서 플러그인 사용자가 그것을 전역 설치했으리라
가정할 수 없고, SKILL.md 의 preflight(`command -v headerlab || echo MISSING-CLI`)는 PATH 만
본다. 심이 있으면 마켓플레이스 설치만으로도 동작하고, 전역 설치가 있으면 그쪽이 PATH 에서
먼저 잡힌다. 둘은 배타적이지 않다.

---

## 6. 확인되지 않은 것

**아무도 이 저장소에서 발행해본 적이 없다.** 두 가지가 미측정이다.

- **레지스트리.** 이 기계의 `npm config get registry` 는 `https://registry.npmjs.org/` 다.
  그러나 CLAUDE.md 가 기록한 프록시 사고는 전부 *설치* 방향이었고, 발행 방향은 시도된 적이
  없다. CI 에서 발행하면 이 기계의 설정과 무관하지만, 그것도 확인할 사실이지 가정할 사실이
  아니다.
- **이름 수용.** `npm view headerlab` 은 404 이므로 비어 있다. 그러나 npm 은 기존 이름과 너무
  비슷한 이름을 거절하기도 하고, 그 판정은 발행을 시도해야 나온다.

**그래서 실제 발행 전에 `npm publish --dry-run` 을 돌린다.** tarball 내용과 이름 수용을 한
번에 확인하고, 아무것도 올리지 않는다.

---

## 7. 테스트

새 층은 없다. 기존 세 층이 그대로 가되 **경로가 바뀐 가드들이 여전히 무언가를 검사하는지**가
이 작업의 합격 조건이다.

- `pnpm check:all` 초록, 그리고 **테스트 개수가 이동 전과 같을 것.** 줄었다면 어떤 스위트가
  경로 때문에 안 돌고 있다는 뜻이다.
- `outbound.test.ts` 의 소스 목록이 비어 있지 않을 것 — 그 파일의 첫 테스트가 본다.
- `pnpm test:e2e` 16/16. 브리지 e2e 가 `packages/cli/lib/install.mjs` 를 임포트하므로 경로
  이동에 직접 걸린다.
- `npm pack --dry-run` 의 파일 목록을 사람이 읽는다.

---

## 8. 이 문서가 닫는 것과 열어두는 것

**닫는다:** §10 의 Q5.

**열어둔다:** CLI 가 npm 에 서면 **버전 스큐**가 새로 생긴다. 사용자가 `headerlab@1.2.0` 을
전역 설치해두고 확장은 다른 버전으로 로드할 수 있다. 지금은 프로토콜에 버전 협상이 없고, 이
설계는 그것을 만들지 않는다 — 명령 스키마가 zod 로 검증되므로 모르는 명령은 `invalid-command`
로 거절되지 조용히 오해되지 않는다. 협상이 필요해지는 시점은 스키마가 **호환되지 않게** 바뀔
때이고, 그때 별도로 정한다.
