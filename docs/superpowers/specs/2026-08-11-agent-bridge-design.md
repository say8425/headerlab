# HeaderLab — Agent bridge: CLI · 네이티브 호스트 · 플러그인 스킬

2026-08-11

## 왜

AI 에이전트가 개발자가 **실제로 쓰는 Chrome** 의 HeaderLab 을 조작할 수 있게 한다.
"스테이징에 Bearer 토큰 붙여줘" 를 사람이 팝업에서 여섯 번 클릭하는 대신 한 문장으로.

이 확장은 숨은 트래커 때문에 스토어에서 내려간 ModHeader 의 대체재다. "AI 가 내
브라우저의 헤더를 조작할 수 있다" 는 기능은 그 이력과 정면으로 부딪힌다. 그래서 이
설계의 절반은 **브리지가 할 수 없는 일**이고, 그 절반이 먼저다.

## 결정된 것

| 축 | 결정 | 근거 |
|---|---|---|
| 연결 경로 | native messaging | 소유자 선택. CDP 는 Chrome 을 평소처럼 띄우면 안 된다는 대가가 있었다 |
| 권한 모양 | `optional_permissions: ["nativeMessaging"]` | 설치 시점 `permissions` 를 한 글자도 안 바꾼다 |
| 명령 표면 | 의미 단위 + 통째 JSON 읽기/쓰기 | 소유자 요구. raw write 는 zod 검증 + 스냅샷을 통과해야 한다 |
| keepalive | **없음** — 포트가 살려둔다 | 실측으로 뒤집힘, §8.4 |
| 팝업 표시 | 리드아웃 카드의 넷째 줄 (안 A) | 레일 여유 28px 에 정확히 들어간다 |
| 레포 모양 | pnpm workspace, **확장은 루트에 유지** | 확장을 옮기면 릴리즈가 조용히 빈 채로 나간다 (§6.1) |
| 버전 추종 | release-please `extra-files` | 독립 PR 을 유지한 채 플러그인 버전만 따라온다 |
| 스킬 배포 | Claude Code 플러그인 + Codex 플러그인, `skills/` 트리 공유 | 매니페스트 둘, 스킬 하나 |

---

## 1. 구조

```
CLI (headerlab)                  Native host              Extension (SW)
node, 의존성 0                    node, 의존성 0            lib/bridge/
   │                                  │                        │
   │  unix socket                     │  stdio                 │
   │  $TMPDIR/headerlab/<n>.sock      │  (4바이트 길이 + JSON) │
   └──────── JSON 한 줄 ─────────────►├───────────────────────►│
            요청/응답                  │                    apply()
   ◄──────────────────────────────────┤◄───────────────────────┤
                                       │                   local:state
                                       │                        ▼
                                    Chrome 이                reconcile()
                                    띄우고 죽임              (기존 단일 루프)
```

**방향이 핵심이다.** 호스트는 확장에 먼저 말을 걸 수 없다. Chromium 에 native-initiated
경로가 있긴 하나(`native_messaging_host_manifest.cc:139-148`) `features::kOnConnectNative`
가 `FEATURE_DISABLED_BY_DEFAULT` 이므로(`chrome_features.cc:1451`) 설계는 **확장이 유일한
개시자**라고 놓는다. CLI 는 재시도 루프가 아니라 "연결 안 됨" 상태를 가져야 한다.

쓰기는 `local:state` 로만 간다. DNR 은 만지지 않는다. `stateItem.watch` 가 이미
`reconcile()` 을 부르므로 이것은 **새 writer 가 아니라 새 trigger** 이고, "One reconcile
loop" 가 유지된다.

---

## 2. 신뢰 모델 — 브리지가 할 수 없는 일

**켜는 것은 사람뿐.** `permissions.request()` 는 user gesture 를 요구한다. 브리지는 팝업
버튼으로만 켜지고 Chrome 자체 동의 대화상자를 거친다. 해제는 `permissions.onRemoved` 로
잡히는데 그 리스너는 이미 `reconcile()` 에 물려 있다 — 새 배선이 아니라 기존 트리거에
얹는다.

**켜져 있으면 보인다.** 팝업이 브리지 상태를 표시한다(§7). 새 어휘를 만들지 않는다.

**끄는 것은 물리적이다.** 토글을 끄면 포트가 닫히고 → Chrome 이 호스트를 죽이고 → 소켓
파일이 사라진다. CLI 는 "꺼져 있음" 을 소켓 부재로 읽는다. **살아있다고 거짓말할 수 있는
플래그가 존재하지 않는다.**

**권한은 못 준다.** CLI 는 사이트를 목록에 넣을 수 있을 뿐이고 그 사이트는 pending 으로
앉아 있는다. Grant 는 사람이 누른다. all-sites 도 모드만 켜고 `<all_urls>` 는 따로 사람이
승인한다 — 지금 UI 가 이미 그렇게 동작하므로 새 예외를 만들지 않는다.

**통째 쓰기는 검증과 스냅샷을 통과한다.** `state set` 은 zod 를 통과하고 1 MB 이하일 때만
저장되며, 쓰기 직전 상태가 스냅샷으로 남는다. 검증 실패는 저장하지 않고 거절한다.

**구현 결과: 스냅샷 절반은 지어지지 않았다.** `lib/bridge/port.ts` 의 `state.set` 처리는
`parseAppState` 검증만 거치고 저장한다 — 쓰기 직전 상태를 남기는 스냅샷도, 그것을 되돌리는
경로도 코드 어디에도 없다(§3 의 `state snapshots | restore <id>` 도 마찬가지로 없다). README
는 이 약속을 한 적이 없으므로 밖으로 나간 거짓은 없지만, 이 문서는 있었다. 원문을 지우지
않고 사실만 옆에 적는다 — 이 저장소의 문서는 기록이다.

**소켓은 사용자 전용 디렉터리에 0600.** §8.5.

---

## 3. 명령 표면

출력은 **항상 JSON 한 덩어리, stdout**. 사람이 읽을 산문을 기본값으로 두면 AI 가 그걸
파싱하고, 그 순간 copy 가 API 가 된다. 에러도 `{"ok":false,"error":{…}}` 이고 exit code 가
따라붙는다.

```
headerlab bridge install|uninstall|status   호스트 매니페스트 설치
headerlab status                            브리지·프로필·진단 요약
headerlab diagnostics                       compile() 진단 그대로

headerlab state get                         AppState 통째 (extension→host, 64 MiB)
headerlab state set <file|->                통째 쓰기 (host→extension, 1 MB 상한)
headerlab state snapshots | restore <id>    raw 쓰기 직전 스냅샷과 되돌리기

headerlab site add|rm <domain>...           filter.domains
headerlab site all-sites on|off
headerlab rule ls|add|rm|toggle             헤더 규칙
headerlab pause | resume                    globalPause
```

**구현 결과: 이 표의 절반 가까이가 아직 없다.** 실제로 존재하는 것은
`site add|rm`·`site all-sites on|off`·`rule add|rm|toggle`·`pause`·`resume`·
`state set` (소켓을 타는 아홉 개)과 `bridge install|uninstall|status` (소켓을 타지 않는
셋, 매니페스트·런처만 다룬다) 뿐이다. **`headerlab status`, `headerlab diagnostics`,
`headerlab state get`, `state snapshots | restore`, `headerlab rule ls` 는 하나도 만들어지지
않았다.** `packages/cli/lib/args.mjs` 의 `parseRule` 은 `add`·`rm`·`toggle` 만 분기하고
`ls` 는 없다. 이름이 `bridge status`
와 겹치는 `headerlab status` 를 만들 때는 그 둘이 서로 다른 것을 답한다는 점 — 하나는 매니페스트
설치 상태, 하나는 브리지·프로필·진단 요약 — 을 헷갈리지 않게 짚어야 한다.

`state set` 의 1 MB 는 프로토콜 상한이지 정책이 아니다. CLI 는 **넘기면 잘리는 대신 먼저
거절한다** — 조용히 잘린 JSON 은 zod 를 통과하지 못하겠지만, 실패 지점이 세 프로세스
건너에서 나면 진단이 불가능해진다.

### 3.1 `state set` 은 아직 없는 정규식 UI 로 가는 통로다

CLAUDE.md 가 이미 적어 둔 것: "import 가 언젠가 만들어지면, 검증이 먼저다 — import 가 정규식
표면을 닿을 수 있게 만드는 것이다." 검증은 이미 먼저 온다(`state.set` 은 `parseAppState` 를
거친다). 하지만 `appStateSchema` 는 `filter.mode: 'regex'` 와 임의의 `regex` 문자열을 그대로
통과시키고, `filterToCondition` 은 검사 없이 그 값을 곧장 `regexFilter` 로 컴파일한다. RE2
유효성의 유일한 권위는 `chrome.declarativeNetRequest.isRegexSupported()` 이고, 그건 어댑터가
아직 부르지 않는다 — 팝업에는 정규식 편집기 자체가 없다.

**결정, 지금 적어 둔다: 정규식 UI 가 생기기 전까지 어댑터는 `filter.mode` 가 `regex` 인
`state.set` 페이로드를 거절한다.** 이건 순수 층이 지는 책임이 아니다 — `apply()` 는
`parseAppState` 를 통과하는 모든 것을 계속 받아들이고, 거절은 CLI/호스트 경계, 즉 phase 4 에
놓인다. 순수 층에 넣으면 정규식 UI 가 나중에 생겼을 때 그 판단이 또 다른 파일에 두 번째로
적히게 된다.

### 3.2 `site.add` 는 못 쓰는 항목도 저장하고, 그 사실을 말한다

`effectiveDomain('a b.com')` 은 쓸 수 없는 입력을 고치지 못하면 그대로 돌려준다(origins.ts).
그 값이 일단 저장되면 `suppressionReason` 이 `'unusable-site'` 를 돌려주고 **프로필 전체가
컴파일을 멈춘다** — 함께 저장된 멀쩡한 규칙까지. "말없이 억제하지 않는다" 는 이 저장소의
비타협 조건이므로 `apply()` 는 이 항목을 거절하지 않되(그 행이 사용자가 실수를 보고 고치는
방법이다) 반환하는 `note` 에 그 호스트를 이름으로 적는다 — §9 가 요구하는 "잘못된 구현이
통과할 수 있는가" 를 site.add 에도 적용한 결과다.

---

## 4. 모듈 배치

기존 `lib/permissions/` 와 같은 모양 — 순수 둘 + 어댑터 하나.

| 파일 | 성격 | 비고 |
|---|---|---|
| `lib/bridge/protocol.ts` | 순수 | 명령 zod 스키마와 결과 타입 |
| `lib/bridge/apply.ts` | 순수 | `(AppState, Command) → AppState \| error`. 심장 |
| `lib/bridge/port.ts` | 어댑터 | `connectNative`·재연결. **`browser` 가 아니라 `chrome.` 을 부른다** |
| `packages/host/headerlab-host.mjs` | Node, 의존성 0 | stdio ↔ 유닉스 소켓 중계 |
| `packages/cli/bin/headerlab.mjs` | Node, 의존성 0 | `node:util` `parseArgs` |
| `packages/plugin/skills/headerlab/SKILL.md` | 문서 | 매니페스트 둘이 공유 |

**CLI 의 원본은 `packages/cli` 한 곳이다.** 플러그인의 `bin/headerlab` 은 사본이 아니라
`packages/cli/bin/headerlab.mjs` 를 실행하는 얇은 심(shim)이고, 워크스페이스 링크로 해석한다.
Claude Code 는 플러그인 루트의 `bin/` 만 PATH 에 올리고 그 키를 재배치할 수단이 없으므로
파일 자체는 거기 있어야 하지만, **로직이 두 벌 존재하는 상태는 만들지 않는다** — 이
저장소에서 가장 비쌌던 결함이 "같은 판단을 네 번 구현하고 갈라진 것"이었다.

**`purity.test.ts` 의 손목록에 `lib/bridge/protocol.ts` 와 `lib/bridge/apply.ts` 를 이름으로
추가한다.** 자동 탐색은 `lib/compile/` 과 `lib/view/` 두 디렉터리뿐이므로 `lib/bridge/` 의
순수 파일은 추가하지 않으면 가드가 없다. `port.ts` 는 `probe.ts` 처럼 가드 대상이 아니다.

### 4.1 "no network primitives" 의 경계를 명시한다

`bundle.test.ts` 의 주장은 **출시되는 확장 번들에 한한다.** 이 저장소의 가장 강한 공개
주장이므로 모호하게 두지 않고 spec 과 CLAUDE.md 에 문장으로 박는다.

CLI 와 호스트에는 **별도의, 더 좁은** 가드를 쓴다 — 유닉스 소켓은 `node:net` 이고 그건
문자 그대로 네트워크 프리미티브라 같은 패턴을 재사용할 수 없다. 금지 대상은 **바깥으로
나가는 것**이다:

- `node:http` · `node:https` · `node:dgram` · `fetch` · `WebSocket` · `EventSource` 금지
- `net` 은 `path` 인자(유닉스 소켓)로만 허용 — 포트·호스트 인자 형태 금지

### 4.2 의존성 정책

`node:util` 의 `parseArgs` 로 인자를 파싱하고, 프레이밍은 직접 쓴다. **새 의존성 0 개를
유지한다.** CLAUDE.md 가 지적하듯 이 규칙의 기계적 강제는 이미 사라졌으므로(pnpm 이
`min-release-age` 를 안 읽는다) 규칙이 아니라 선택으로 지킨다.

---

## 5. 팝업 (안 A)

리드아웃 카드에 넷째 줄을 더한다. 시안: `docs/design/2026-08-11-agent-bridge-placement.html`.

```
┌─ card ────────────────────┐
│ 3  of 4 rules live        │
│ ● 1 off                   │
│ ● Active         [━●]     │
│ ● Bridge live   [Disable] │  ← +28px
└───────────────────────────┘
```

세 상태, 모두 같은 높이:

| 상태 | 점 | 라벨 | 오른쪽 |
|---|---|---|---|
| 권한 없음 | `muted-foreground` | Bridge off | `Enable` 버튼 |
| 권한 있음, CLI 안 붙음 | `muted-foreground` | Bridge idle | `Disable` 버튼 |
| CLI 붙음 | `live` | Bridge live | `Disable` 버튼 |

**구현 후: `idle` 의 뜻이 위 표의 "CLI 안 붙음"과 다르게 굳어졌다 — 이유가 있어서다.**
확장은 호스트가 유닉스 소켓에 붙인 클라이언트를 볼 방법이 없다 — 보이는 것은 자기가 연
`connectNative` 포트 하나뿐이다. 호스트가 그 클라이언트 목록을 확장에 알리게 만드는 것은
가능하지만, 그러면 지금 "멍청한 릴레이"인 호스트가 프로토콜 참여자가 된다 —
`packages/cli/lib/bridge.mjs` 가 이름으로 반대해 둔 바로 그것이다. 그래서 구현된 `idle` 은
**권한이 있고 포트가 안 열린 상태**를 뜻하고, 실제로 이 상태에 놓이는 흔한 경로는 "CLI가
안 붙었다"가 아니라 "`Enable` 은 눌렀지만 `headerlab bridge install` 을 아직 안 돌린" 것이다.
위 표의 원문은 그대로 남긴다 — 이 저장소의 문서는 기록이다.

**컨트롤은 스위치가 아니라 버튼이다.** all-sites 스위치가 `permissions.request()` 를
부르지 않도록 이미 고쳐졌고 그 이유가 그대로 적용된다 — "컨트롤이 움직였다는 이유로 권한
대화상자를 띄우는 것".

"마지막 외부 쓰기 시각" 은 `title` 로 간다. 레일 여유가 28px 뿐이라 둘째 줄을 살 수 없다.

**28px 은 소스에서 읽은 값이다. 구현 시 빌드된 팝업에서 다시 잰다.** 사이트 목록의
`max-height:132px` 는 일부러 행 피치의 배수가 아니게 잡혀 셋째 행을 반쯤 자르는데, 그
affordance 가 살아있는지가 합격 조건이다.

**실측 결과: 28px 이 아니라 7px 이었다.** `docs/design/2026-08-12-agent-bridge-rail-budget.html`
이 빌드된 팝업 치수로 다시 쟀다 — 레일 예산 576px 에 기존 네 블록(브랜드·리드아웃 카드·
사이트 섹션·요청 타입)이 이미 569px 을 쓰고 있어 진짜 여유는 7px 뿐이었다. 나머지 21px 은
넷째 줄 자신이 줄어들어 나온 것이 아니라, 기존 마진 다섯 곳에서 한 단계씩 덜어내 만들었다:
리드아웃 카드와 사이트 섹션 자신의 `mt-4`→`mt-3`, 요청 타입 섹션의 `pt-3`→`pt-2`, 브리지
줄 자신의 `mt-2`→`mt-1`(Tailwind 한 단계 4px, 넷이므로 16px), 그리고 사이트 목록
`max-height` 를 `132px`→`127px`(5px). 16 + 5 = 21. 결과: 예산 576 / 사용 576 / 여유 0 —
이 레일에 더 넣을 다음 줄은 여기서부터 다시 계산해야 한다. 자세한 수치는
`components/ScopeRail.tsx`의 사이트 목록 docblock과
`docs/superpowers/sdd/2026-08-12-agent-bridge-extension/progress.md`의 Task 3 항목에 있다.

---

## 6. 모노레포와 릴리즈

### 6.1 확장은 루트에 남는다 — 이유가 지뢰다

release-please-action v5.0.0 을 핀된 SHA 에서 읽었다(`src/index.ts:178-184`): 패키지 경로가
`.` 이 아니면 출력 이름에 경로 접두사가 붙는다. `release_created` →
`packages/extension--release_created`.

`release-please.yml` 은 그 이름을 다섯 군데서 참조한다(36·42·46·49·52행). 전부 빈 문자열로
평가되어 false 가 된다. **결과: 태그와 릴리즈는 만들어지고, `pnpm check` 도 `pnpm zip` 도
안 돌고, zip 이 안 붙은 릴리즈가 나간다. 아무것도 빨개지지 않는다.** `contents: write` 를
가진 유일한 잡에서, CI 에는 보이지 않게.

확장을 `.` 에 두면 이 문제 자체가 없다. 태그 연속성(`v1.0.0`), 루트 CHANGELOG, 다섯 개
출력 참조, oxlint/oxfmt 경로가 전부 그대로다.

```
.                       확장 (그대로)
packages/cli/           headerlab CLI
packages/host/          네이티브 메시징 호스트
packages/plugin/        .claude-plugin/ + .codex-plugin/ + skills/
```

### 6.2 pnpm workspace

`pnpm-workspace.yaml` 은 **append-only 로 다룬다.** 기존 주석과 `allowBuilds` 를 그대로
두고 `packages:` 키만 더한다. 그 주석은 패키지가 아니라 의존성 *사슬*
(`wxt → web-ext-run → fx-runner`)을 지목하므로 분리 후에도 참이다.

루트 스크립트는 순수 `pnpm -r <name>` 팬아웃으로 둔다. **`--include-workspace-root` 를
절대 쓰지 않는다** — 측정 결과 자식 스크립트가 두 번 돈다. e2e 는 echo 서버가 루프백에
바인딩하므로 포트 충돌이 된다.

**루트에 `"lint": "oxlint --deny-warnings"` 를 쓰지 않는다.** `wxt prepare` 가 빠지면
`.wxt/tsconfig.json` 없이 돌고, CLAUDE.md 의 측정대로 `@/…` 임포트를 하나도 안 보고 exit 0
한다. 이게 이 이관에서 가장 나올 법한 회귀다.

`.oxlintrc.json` 의 `files` 글롭과 `.oxfmtrc.json` 의 `ignorePatterns` 는 설정 파일 기준
상대 경로다. 확장이 루트에 남으므로 기존 항목은 그대로 두고, 새 패키지용 override 만
더한다. **중첩 설정 파일은 만들지 않는다** — 측정 결과 중첩 `.oxlintrc.json` 은 루트의
`plugins` 배열까지 통째로 무효화한다.

### 6.3 release-please

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

워크플로 수정은 **`release-type: node` 한 줄 삭제**가 전부다. `config-file` 과
`manifest-file` 은 선택 입력이고(`index.ts:57-58`), `releaseType` 이 있으면
`Manifest.fromConfig` 로 빠져 매니페스트 모드에 도달하지 않는다(`:92`).

알아야 할 것들, 전부 17.6.0 소스에서 확인:

- `include-component-in-tag` 는 **매니페스트 모드에서 기본 true** (`base.ts:152`) — 액션
  입력의 `default: false` 와 반대다. 태그 네임스페이스 `v<version>` 을 지킬 수 있는
  패키지는 **정확히 하나**이고, `v1.0.0` 은 확장의 것이다.

  **2026-08-14 에 뒤집혔다.** 확장에서 그 플래그를 걷고 `"component": "extension"` 을 줬다.
  이유는 태그가 아니라 **릴리즈 제목**이다 — release-please 는 GitHub 릴리즈 이름을
  `<component>: v<x.y.z>` 로 짓고, component 는 **태그에 있을 때만** 거기 닿는다. 같은
  액션을 쓰는 형제 저장소에서 실측: 태그 `diffdeck-v1.3.2`, 이름 `diffdeck: v1.3.2`.
  bare 네임스페이스를 쥔 채로는 확장의 릴리즈가 `v1.1.0` 이라고만 적혀, 페이지를 여는
  사람이 무엇이 릴리즈됐는지 알 수 없었다. 이제 `extension: v1.1.1` 과 `cli: v0.1.1` 이
  나란히 선다.

  **이미 나간 `v1.0.0`·`v1.1.0` 은 그대로 둔다.** 형식이 바뀌면 release-please 가 이전
  릴리즈를 못 찾을 수 있으므로 `extension-v1.1.0` 을 같은 커밋에 별칭 태그로 얹는다 —
  버전 자체는 매니페스트가 들고 있어 안전하지만, 변경 내역의 커밋 범위는 태그로 찾는다.
  **component 를 비워두면 기본값이 패키지 이름에서 온다.** 루트는 `headerlab` 이라
  `headerlab: v1.1.1` 이 되어 CLI 와 구분이 안 된다. 그래서 값으로 고정한다.

  **2026-08-15 에 다시 뒤집혔다.** 바로 위 문단의 "그대로 둔다"는 더 이상 사실이 아니다.
  `v1.0.0`·`v1.1.0` 태그는 삭제됐고, 이제 이 저장소의 모든 태그가 자기 패키지 이름을
  단다. 릴리즈를 **지우지 않고 옮긴** 것이 요령이다 — `PATCH /repos/{o}/{r}/releases/{id}`
  가 `tag_name` 을 받으므로 릴리즈 객체가 id·에셋·다운로드 카운트를 그대로 쥔 채 다른
  태그로 이동한다. `v1.0.0` 의 `headerlab-1.0.0-chrome.zip` 은 이미 한 번 받아간 기록이
  있어서, 삭제-재생성은 그 배포물과 카운트를 파괴했을 것이다. 순서는 되돌릴 수 없다:
  목적지 태그를 먼저 만들고, 릴리즈를 옮기고, **그다음** 옛 태그를 지운다 — 먼저 지우면
  릴리즈가 고아가 된다. `extension-v1.1.0` 은 **별칭 태그가 아니라 진짜 태그가 됐고**,
  `extension-v1.0.0` 은 `dbd1b39` 에 새로 만들었다. release-please 가 이전 릴리즈를 찾는
  경로는 영향을 받지 않는다: 태그 형식이 `extension-v*` 이므로 삭제된 두 태그는 애초에
  그 형식과 맞지 않았다. 자세한 것은 CLAUDE.md 의 Release 절.
- 바 문자열 `extra-files` 항목은 **확장자로 디스패치**한다(`base.ts:477-520`). `.json` →
  `$.version`. 그래서 위 두 줄이 이미 원하는 일을 한다.
- `extra-files` 경로는 `/` 로 시작하면 레포 루트 기준, `..` 는 **throw**. 측정: `../x` throw,
  `.claude-plugin/plugin.json` OK — 선행 점 *디렉터리*는 안전하다.
- **11개 `extraFileUpdates.push` 가 전부 `createIfMissing: false`** (`base.ts:424-519`).
  경로가 틀리면 에러도 diff 도 없다. 오타 하나면 버전 추종이 조용히 멈춘다.
- **런타임 설정 검증이 없다.** `$schema` 는 에디터용이고, 패키지별 오타는 에디터에서도
  안 잡힌다(`component` 는 `manifest.ts:1408` 이 읽지만 스키마에 없다).
- 새 패키지는 **정확히 `"0.0.0"`** 으로 시드한다(`manifest.ts:707-711`).
- `Expected N releases, only found M` 은 `"0.0.0"` 패키지가 있는 한 **매 실행 출력되는
  상시 노이즈**다. 경보로 읽는 절차를 만들지 않는다.
- `bootstrap-sha` 는 넣지 않는다. 매 실행 재계산되고, 남아 있으면 새 패키지가 추가될 때
  되살아나 모든 changelog 를 잘라낸다.

### 6.4 가드 둘

런타임 검증이 없으므로 기계적 방어는 이 둘뿐이다.

1. `release-please-config.json` 을 파싱해 모든 키가 핀된 스키마의 property 집합에 있고
   모든 `packages` 키가 실재 디렉터리인지 단언한다.
2. `release-please.yml` 이 참조하는 모든 출력 이름이 설정된 패키지 경로가 실제로 만들 수
   있는 이름인지 단언한다.

### 6.5 npm 발행

`private: true` 인 패키지는 npm 이 `EPRIVATE` 로 거절한다. 확장과 플러그인은 플래그를
유지하고 발행 단계가 없다. **CLI 를 npm 에 올릴지는 미결이다** — CLAUDE.md 가 기록한 프록시
문제가 그대로 걸리므로 별도 결정이 필요하다(§10, Q5). 그때까지 CLI 도 `private: true` 로
두고 플러그인에 번들한다.

**2026-08-14 결정됨.** 위 문단은 그 시점의 기록으로 남기고, 무엇이 정해졌는지는 옆에
적는다: 사람이 직접 설치해 쓸 수 있어야 한다는 소유자 결정에 따라 CLI 는 발행된다.
`packages/cli` 와 `packages/host` 를 `packages/headerlab` 한 패키지로 합쳐 `private: true`
를 뺐고(그 플래그가 지금까지의 안전장치였다), `--provenance` 를 붙여 `release-please.yml`
의 `release_created` 분기에서 발행한다. 프록시 문제는 설치 방향에서만 실측되어 있었고
발행 방향은 이 결정 전에는 시도된 적이 없었다 — 시도해보니 이 기계의 레지스트리는
프록시 없이 `registry.npmjs.org` 로 그대로 풀렸다. 근거와 확인 방법 전부는
`docs/superpowers/specs/2026-08-14-cli-npm-publication-design.md` 에 있고, §10 의 Q5 가
그 문서를 가리킨다.

---

## 7. 스킬 플러그인

`packages/plugin/` 하나가 매니페스트 둘을 이고 `skills/` 트리 하나를 공유한다. 이미
superpowers 플러그인이 쓰는 모양이다.

```
packages/plugin/
  .claude-plugin/plugin.json     name, version, description
  .codex-plugin/plugin.json      + author{}, interface{7필드}
  skills/headerlab/SKILL.md      name, description  ← 양쪽이 공유
  bin/headerlab                  CLI 진입점 (Claude Code 는 PATH 에 올린다)
```

**Claude Code**: `.claude-plugin/plugin.json` 의 top-level `version` 이 캐시 키다. `name` 만
필수. `bin/` 은 플러그인 루트여야 하며(재배치 키가 없다) Bash 도구의 PATH 에 오른다 —
측정으로 확인했다. marketplace 항목에는 **`version` 을 넣지 않는다**: 넣으면 plugin.json 과
어긋날 수 있는 드리프트 종류가 하나 생기고, 실제로 어긋나면 설치가 exit 1 한다.

**Codex** (codex-cli 0.145.0): `codex plugin` 은 실재하는 서브커맨드다. 다만 동봉된
`validate_plugin.py` 기준 `author`(객체)와 `interface`(displayName·shortDescription·
longDescription·developerName·category·capabilities·defaultPrompt) 가 전부 필수이고 `hooks`
는 거부된다. `.claude-plugin` 폴백이 바이너리 문자열에 보이긴 하나 **확인되지 않았으므로
`.codex-plugin/plugin.json` 을 명시적으로 쓴다.**

**SKILL.md 하나로 양쪽을 만족한다.** 공통 필수는 `name` + `description` 뿐이다. 에이전트별로
마크다운을 번역·생성하는 설계는 불필요한 일이다.

**스킬은 CLI 존재를 스스로 확인한다.** 선언적 preflight 는 없지만 동적 컨텍스트 주입은
있다 — SKILL.md 의 `` !`command -v headerlab || echo MISSING-CLI` `` 는 스킬 본문이 모델에
닿기 전에 실행되어 **사실**을 넘긴다. 산문으로 "없으면 알아채라" 고 부탁하는 것은 이
저장소 정의상 silent failure 다.

**Tailwind 비용을 잰다.** `packages/plugin/` 은 점으로 시작하지 않는 경로이고 `style.css:13`
의 `@source not "../../docs"` 는 이걸 안 덮는다. CLAUDE.md 의 두 측정(점 디렉터리는 건너뜀,
`.md` 는 스캔 안 함)이 매니페스트 `.json` 까지 덮는지는 확인되지 않았다. **빌드 전후로 팝업
CSS 바이트 수를 비교한다** — 143 B 를 잰 그 도구 그대로.

---

## 8. 네이티브 메시징 제약

전부 Chromium 소스나 실측에서 나왔다. 다시 유도하지 말 것.

### 8.1 `nativeMessaging` 은 optional 가능하다

`extensions_api_permissions.cc:113-114` 에 `kFlagCannotBeOptional` 이 없다(`declarativeNetRequest`
는 `:57-59` 에서 그 플래그를 단다). **HeaderLab 은 zero-permission 설치 자세를 유지한다.**

**실행됐다. 받아진다.** 팝업 버튼에서 호출하니 Chrome 의 동의 대화상자가 떴고, 허용하자
승인됐으며, 두 번째 클릭은 대화상자 없이 곧장 `connectNative` 로 갔다 — 승인이 유지된다.
`docs/research/2026-08-11-native-messaging-spike.md`. 이 설계에서 가장 무거운 전제였고
살아남았다.

플래그가 바뀌면 실패가 조용하다: `permissions_parser.cc:301-326` 이 optional 불가 권한을
목록에서 지우고 설치 경고만 남기며, 유일한 정합성 검사 `DCHECK_EQ` 는 릴리즈 빌드에서
컴파일 아웃된다. **매니페스트 문자열이 아니라 런타임 승인을 가드한다.**
`manifest.test.ts` 는 `permissions` 와 `optional_host_permissions` 를 정확히 고정하지만
`optional_permissions` 는 읽지 않는다 — 새 키에도 정확값 단언을 붙인다.

### 8.2 호스트 매니페스트 위치는 고정 경로가 아니다

`chrome_paths.cc:478-483` — `DIR_USER_DATA + "NativeMessagingHosts"`. **`--user-data-dir` 이
바꾼다.**

- Chrome: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
- Chromium: `~/Library/Application Support/Chromium/NativeMessagingHosts/`

**e2e 에 결정적이다.** `tests/e2e/fixtures.ts:26` 의 `launchPersistentContext('')` 는 매
실행 새 임시 user-data-dir 을 준다. 네이티브 메시징 e2e 는 Playwright 가 만든 그 디렉터리
안에 매니페스트를 써야 한다. 홈 경로에 설치하고 e2e 를 돌리면 호스트는 **조용히 없다.**

### 8.3 확장 ID 와 실패 표시

`allowed_origins` 는 와일드카드가 **하드 파스 실패**이고 정확한 `chrome-extension://<ID>/`
여야 한다(`native_messaging_host_manifest.cc:131-134`).

unpacked ID 는 로드 경로 **바이트**의 SHA-256 앞 16바이트를 0-f → a-p 로 매핑한 것
(`id_util.cc:41-67`). 조사 중 오프라인으로 계산된 값:

- `.output/chrome-mv3` → `emdiklpbkfcdhnljlaikoclahpkjledp`
- `.output/chrome-mv3-e2e` → `pmgannfbibibkgoaboagbnchkaapekjj`

**두 빌드는 서로 다른 호스트 매니페스트가 필요하다.** 심링크나 철자가 다른 같은 디렉터리도
다른 ID 를 낳는다 — 이 두 값은 **이 저장소가 이 절대 경로에 있을 때만** 맞다.

위 두 값은 이 문서에 옮겨 적힌 것이고 아직 손으로 재현되지 않았다. **인스톨러는 값을
하드코딩하지 않고 매번 로드 경로에서 계산하며**, 구현 시 실제로 로드된 확장의 ID 와
대조하는 것이 §8.3 이 요구하는 자기 검증이다. 위 값은 그 대조가 무엇과 맞아야 하는지를
알려주는 참고치이지 설계가 기대는 상수가 아니다.

**확장은 매니페스트 오류를 절대 못 본다.** 거부된 매니페스트는 `RESULT_NOT_FOUND`, ID 가
틀린 매니페스트는 `RESULT_FORBIDDEN` 이고 진짜 이유는 Chrome 로그에만 남는다. **인스톨러가
자기 출력을 스스로 검증한다** — Chrome 이 설명해주길 기대하는 것은 이 저장소 정의상 silent
failure 다.

**세 번째 원인이 실측으로 추가됐고, 문구가 앞의 둘과 똑같다.** Chrome 은 호스트를 **자기
환경**으로 띄우며 그 PATH 에는 nvm 도 homebrew 도 없다. `#!/usr/bin/env node` 셔뱅은 해석에
실패하고, 스크립트는 첫 줄도 못 돌며, 확장이 받는 것은
`{"message":"Native host has exited."}` 뿐이다 — 호스트 로그는 두 번의 연결 시도 내내
완전히 비어 있었다. 절대 경로 셔뱅으로 바꾸자 `env -i` 아래에서도 정상 실행됐다.

즉 **매니페스트 거부·ID 불일치·인터프리터 부재가 확장 쪽에서 구분되지 않는다.** 인스톨러의
요구사항: `path` 는 최소 환경에서 실행되는 것을 가리켜야 하고, 설치 직후 그것을 **직접 한 번
실행해 확인**해야 한다. 이건 §8.5 가 `$TMPDIR` 에 대해 추론해둔 것과 같은 뿌리이고 —
호스트는 Chrome 의 환경을, CLI 는 터미널의 환경을 물려받는다 — 이제 측정된 사실이다.

### 8.4 keepalive — 필요 없다. 실측했다

**측정됨** (Chrome 151.0.7922.108, macOS 26.4.1, unpacked):
`docs/research/2026-08-11-native-messaging-spike.md`.

하트비트를 끈 채 포트 둘을 열고 최초 echo 이후 **아무 트래픽 없이** 7분을 두었더니 호스트 둘이
그대로 살아 있었다. 30초 유휴 타임아웃도, 제거된 5분 상한도 넘겼다. **열려 있다는 사실 자체가
SW 를 살려둔다.**

**틀렸던 것은 이 절이 아니라 결정 표였다.** 이 문서의 이전 판(`6de7589`)은 자기 안에서
어긋나 있었다: 21행 결정 표는

```
| keepalive | 하트비트 + `alarms` 복구 바닥 | 열린 포트만으로는 SW 가 안 산다 |
```

라고 적어 "열린 포트만으로는 SW 가 안 산다"는 반대 주장을 폈지만, 바로 이 §8.4 절의 본문은
같은 커밋에서 이미 "공식 문서 기준: 열린 `connectNative` 포트는 MV3 SW 를 살려둔다"고 맞게
적어 두고 있었다. 이 스파이크는 §8.4 를 뒤집은 것이 아니라, 결정 표 쪽의 주장을 실측으로
반박하고 본문이 이미 알고 있던 사실을 확인한 것이다. 위 표의 keepalive 행이 "없음 — 포트가
살려둔다"로 바뀐 것이 그 결과다.

따라서:

- **하트비트를 넣지 않는다.** 유지할 것이 없다.
- **`alarms` 를 넣지 않는다.** 권한이 하나 준다. SW 가 실제로 죽는 경우 — 브라우저 재시작,
  확장 리로드, 크래시 — 는 `background.ts` 가 **이미 듣고 있는** `onStartup`·`onInstalled` 가
  덮는다. 재연결은 새 기제가 아니라 기존 배선에 얹는다.
- `onDisconnect` 에 **제한된** 재시도만 더한다. 무제한 재시도는 인터프리터가 없거나 ID 가
  틀린 경우(§8.3) 무한 루프가 된다 — 그 둘은 재시도로 낫지 않는다.

**한계, 그대로 남긴다.** 7분은 무한이 아니고 unpacked 로드다. unpacked 예외는 `chrome.alarms`
스로틀에 걸리는 것이지 포트 keep-alive 와는 다른 기제라 이 측정은 유효하다고 보지만, packed
에서 다시 잰 적은 없다. `alarms` 를 쓰지 않기로 했으므로 그 스로틀은 이제 이 설계에 걸리지
않는다.

### 8.5 소켓

- `$TMPDIR` 은 사용자 전용 0700 이다. **`/tmp` 가 아니다.** `getconf DARWIN_USER_TEMP_DIR`
  로 해석한다 — 호스트는 Chrome 의 환경을, CLI 는 터미널의 환경을 물려받으므로 `$TMPDIR`
  환경변수가 어긋나면 양쪽이 다른 곳을 보고 에러가 안 난다.
- Node 의 `listen()` 은 소켓을 **world-connectable** 로 남긴다(umask 022 아래 0755). macOS 는
  연결 시 권한을 실제로 강제한다. **`listen()` 전에 umask 077 을 걸고, 부모 디렉터리 0700 을
  진짜 방어선으로 삼는다.** 히든 트래커 때문에 존재하는 제품이 `chrome.storage.local` 로 가는
  world-connectable 소켓을 깔 수는 없다.
- `sun_path` 의 실사용 한계는 **정확히 104자**(측정: 104 성공, 105 EINVAL). 시작 시 조립된
  길이를 검사하고 **숫자와 함께 실패**한다.

### 8.6 다중 인스턴스

`launch_context.cc:202-206` — Chrome 이 넘기는 것은 확장 origin 뿐이다. `--parent-window` 는
Windows 전용, `--profile-directory`/`--user-data-dir` 은 native-initiated 분기 안에만 있다.
**두 프로필은 argv 가 바이트 단위로 동일한 두 호스트 프로세스를 낳고 자기를 식별할 방법이
없다.**

충돌 축은 "프로필 둘" 보다 넓다 — 매니페스트 디렉터리가 user-data-dir 파생이므로 두 번째
Chrome 설치, Chrome for Testing, **그리고 모든 Playwright 실행**이 각자의 위치를 갖는다.
**"N개의 동시 호스트, 아무도 자기를 식별하지 못함" 으로 설계한다.**

채택: 호스트는 자기 PID 로 접미사를 붙인 `<dir>/bridge-<pid>.sock` 에 바인딩하고, 같은
디렉터리에 `<pid>.json`(확장 origin, 시작 시각)을 쓴다. 첫 호스트가 잘 알려진 이름을
차지하는 방식은 쓰지 않는다 — 그러면 두 번째가 무엇을 해야 할지가 다시 미결이 된다.

CLI 는 디렉터리를 열거한다. 살아있는 항목이 하나면 그것을 쓰고, 여럿이면 **`--bridge <pid>`
힌트와 함께 전부 나열하며 에러**로 끝난다. 죽은 항목(§8.7 의 2초 예산을 못 지킨 잔해)은
아무도 듣고 있지 않음을 확인한 뒤 치운다. 두 번째 인스턴스의 사용자가 보는 것은 그
목록이다 — 조용히 지는 쪽이 없다는 것이 요점이다.

### 8.7 종료

`native_message_process_host.cc:86-101` → macOS `kill_mac.cc:167-170` 은 **최대 2초를 기다린
뒤에야** SIGKILL 한다.

- **닫힌 stdin 이 종료 신호다**(`nmph.cc:295-296`).
- **SIGTERM 핸들러를 기대하고 달지 않는다** — 오지 않는다.
- 정리(소켓 unlink)는 **2초 한참 아래**에 끝낸다. 그러면 정상 경로에서 SIGKILL 되지 않고
  소켓을 남기지 않는다.
- 그럼에도 **시작 시 죽은 소켓을 unlink 한다.** 2초는 예산이지 보장이 아니다. 단, 지우기
  전에 아무도 듣고 있지 않은지 확인한다 — 아니면 살아있는 두 번째 호스트의 소켓을 세 번째가
  뺏는다.

### 8.8 프레이밍

32비트 길이 접두사, **native byte order**, JSON 본문, UTF-8. host→extension **1 MB**,
extension→host **64 MiB**.

Node 에 native-order 32비트 쓰기 헬퍼는 없다. `os.endianness()` 로 분기한 `DataView` 나
`Uint32Array` 를 쓴다.

**`os.endianness()` 와 일치하는지, `writeUInt32LE` 와 같은지 단언하는 테스트를 쓰지 않는다.**
이 프로젝트가 도는 모든 기계에서 하드코딩 LE 구현도 두 단언을 통과한다 — CLAUDE.md 가
이 저장소의 반복 결함으로 지목한 "실패할 수 없는 단언" 그 자체다. 이빨이 있는 유일한 가드는
바이트를 빅엔디언 해석으로 되읽어 다르다고 단언하거나, 구현이 실제로 분기 경로를 타는지
단언하는 것이다. **지원되는 Chrome 플랫폼 중 빅엔디언은 없다는 사실을 같이 적는다** — 이
테스트가 무엇을 덮지 않는지 밝히는 게 덮는 척하는 것보다 낫다.

---

## 9. 테스트

세 층은 그대로 간다.

**순수** — `apply.ts` 가 심장이고 브라우저 없이 전부 테스트된다. 명령마다: 잘못된 구현이
통과할 수 있는가? `toEqual`/`toHaveLength` 를 쓰고 `toContain` 은 부분 일치가 실제 의도일
때만 이유를 달아 쓴다.

**어댑터** — `port.ts` 는 손으로 심은 스파이로. `@webext-core/fake-browser` 는
`runtime.connectNative` 를 정의하지 않으므로 스텁을 심는다.

**e2e** — 네이티브 메시징 e2e 는 §8.2 때문에 Playwright 의 임시 user-data-dir 안에 매니페스트를
써야 한다. 이게 이 층에서 유일하게 새로운 어려움이다.

**두 개의 staleness 가드가 따로 산다** — `tests/support/build.ts` 와
`scripts/screenshots.mjs:147-173` 이 같은 검사를 독립적으로 구현한다. 하나만 고치면 다른
하나가 깨진다. `pnpm screenshots` 는 이 저장소에서 픽셀이 들어있는 유일한 출력이다.

**변이 검증**은 커밋 후에 한다.

---

## 10. 미결과 빚진 스파이크

| # | 질문 | 정하는 법 |
|---|---|---|
| ~~Q10~~ | ~~런타임 승인이 실제로 떨어지는가~~ | **답함 — 떨어진다.** §8.1, 스파이크 문서 |
| ~~Q11~~ | ~~관측되는 keepalive 는 얼마인가~~ | **답함 — 포트만으로 7분+ 산다.** §8.4, 스파이크 문서 |
| Q12 | 호스트가 포트가 닫힌 *이유*(비활성화/종료/권한 해제)를 구분할 수 있는가 | 값이 내려갔다. Q11 이 "유휴로는 안 죽는다"로 답하면서 네 경우 중 하나가 사라졌고, 나머지를 가르는 것은 UI 가 이유를 말해야 할 때만 필요하다. 필요해지면 확장이 끊기 전에 이유를 포트로 내려보내는 것이 유일한 방법이다. **구현 완료 시점에도 필요하지 않았다** — `idle` 을 "포트가 안 열림"으로 재정의해 §5 가 그 이유를 흡수했고, 팝업은 `bridgeError` (Chrome 이 준 마지막 연결 실패 메시지)만으로 "Bridge down" 행을 채운다 |
| ~~Q5~~ | ~~CLI 를 npm 에 올리는가, 어느 레지스트리로~~ | **답함 — 올린다, 스코프 없는 `headerlab` 하나로, `registry.npmjs.org`.** §6.5, `docs/superpowers/specs/2026-08-14-cli-npm-publication-design.md` |
| Q13 | Codex 의 `.claude-plugin` 폴백이 0.145.0 에서 실제로 도는가 | 스크래치 마켓플레이스로 확인. 단 `~/.codex/config.toml` 을 건드린다 |
| Q9 | 이관이 Tailwind 스캔 집합과 팝업 CSS 바이트 수를 바꾸는가 | 전후 빌드하고 `wc -c` 비교 |

---

## 11. 단계

1. **workspace 골격** — `packages:` 추가, `packages/cli`·`packages/host`·`packages/plugin`
   껍데기, 루트 팬아웃 스크립트, oxlint/oxfmt override. `pnpm check` 초록.
2. **순수 층** — `protocol.ts`·`apply.ts` 와 그 테스트, purity 손목록 추가. 브라우저 없음.
3. **스파이크 Q10·Q11** — 런타임 권한 승인과 packed 빌드 keepalive. 결과를
   `docs/research/` 에 기록한다. **여기서 나온 사실이 4단계를 바꿀 수 있다.**
4. **호스트와 어댑터** — `headerlab-host.mjs`, `port.ts`, 소켓·프레이밍·종료·다중 인스턴스.
   **완료.**
5. **CLI** — 명령 표면, JSON 출력, `bridge install` 의 자기 검증. **완료.**
6. **팝업** — 안 A, 그리고 28px 실측. **완료** — 실측은 28px 이 아니라 7px 이었고, §5 의
   교정 참고.
7. **릴리즈** — `release-please-config.json`, 매니페스트, 워크플로 한 줄 삭제, 가드 둘.
8. **플러그인과 스킬** — 매니페스트 둘, SKILL.md, preflight, `claude plugin validate --strict`.
9. **README** — §1 모식도와 CLI 사용 예시. 소유자가 명시적으로 요청했다.

3단계 결과에 따라 4단계 이후가 달라질 수 있으므로, 1–3 을 먼저 하고 다시 본다.
