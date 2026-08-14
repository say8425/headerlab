# Agent bridge — 3차 인계

2026-08-12. 브랜치 `agent-bridge`, PR #17, 66커밋. 컴팩트 전 캡슐.

## 결정된 것

**3차까지 끝내고 한 번에 병합한다.** 소유자 판단: 동작하지 않는 상태로 `main` 에
들어가는 것보다 PR 이 커지는 편이 낫다. 그러므로 **지금 PR #17 을 병합하지 않는다.**

## 지금 있는 것

| | |
|---|---|
| `lib/bridge/protocol.ts` | 아홉 명령의 zod 스키마와 결과 타입. 순수 |
| `lib/bridge/apply.ts` | 리듀서 전부. 열 번째 명령이 case 없이 오면 컴파일 실패 |
| `packages/host/` | 프레이밍 · 소켓 · 수명 · 경합. 의존성 0 |
| `packages/cli/` | `headerlab` — 인자 파싱, 브리지 열거, 요청 id 상관관계. 의존성 0 |
| `packages/plugin/` | `skills/` 하나에 매니페스트 둘(Claude Code · Codex) |
| 릴리즈 | 매니페스트 모드. 확장 `v1.2.3`, CLI `cli-v0.1.0`, 독립 PR |
| 문서 | 설계 spec, 계획 둘, 스파이크 실측, 팝업 시안 3안, README 절 |

테스트: 루트 755 · 호스트 43 · CLI 54. `pnpm check:all` 초록.

## 3차에 남은 것 — 이것만 하면 브리지가 동작한다

### 1. `lib/bridge/port.ts` — 확장 쪽 어댑터

`chrome.runtime.connectNative` 를 부르는 유일한 파일. **purity 가드에 넣지 않는다** —
`purity.test.ts` 의 주석이 이미 그 이유를 적어두었고 `lib/permissions/probe.ts` 와 같은
자리다.

실측으로 확정된 제약(재유도 금지):

- **`browser.runtime.connectNative` 는 함수가 아니다.** WXT 래퍼가 노출하지 않는다.
  `chrome.` 을 직접 부른다.
- **하트비트도 `alarms` 도 넣지 않는다.** 열린 포트가 SW 를 살려둔다 — 하트비트 없이
  7분, 30초 유휴 타임아웃과 제거된 5분 상한을 모두 넘겼다.
- **재연결은 새 기제가 아니라 기존 배선에 얹는다.** SW 가 실제로 죽는 경우(브라우저
  재시작·확장 리로드·크래시)는 `background.ts` 가 이미 듣는 `onStartup`·`onInstalled`
  가 덮는다. `onDisconnect` 에 **제한된** 재시도만 더한다 — 무제한은 인터프리터 부재나
  ID 불일치에서 무한 루프가 된다(그 둘은 재시도로 낫지 않는다).
- **regex 모드 `state.set` 을 거절한다.** 설계 §3.1. 팝업에 regex 편집기가 없고
  `isRegexSupported()` 는 `chrome.*` 호출이라 순수 층이 질 수 없다. 이 거절은 어댑터의
  책임이고 README 의 Status 절에도 적혀 있다.
- 호스트가 보내는 응답에 **요청 id 를 그대로 되돌려줘야 한다.** CLI 가 그걸로 자기
  응답을 가려낸다(호스트는 모든 클라이언트에 브로드캐스트한다). 이 계약은
  `packages/cli/lib/bridge.mjs` 의 `sendCommand` 독블록에 적혀 있다.

### 2. 팝업의 브리지 행 — 승인된 안 A

시안: `docs/design/2026-08-11-agent-bridge-placement.html`.

리드아웃 카드의 넷째 줄, **+28px**. 레일 여유가 그만큼뿐이라 둘째 줄을 살 수 없다 —
"마지막 외부 쓰기 시각"은 `title` 로 간다. **28px 은 소스에서 읽은 값이므로 빌드된
팝업에서 다시 잰다.** 합격 조건: 사이트 목록의 `max-height:132px` 가 셋째 행을 반쯤
자르는 affordance 가 살아있을 것.

세 상태, 모두 같은 높이:

| 상태 | 점 | 라벨 | 오른쪽 |
|---|---|---|---|
| 권한 없음 | `muted-foreground` | Bridge off | `Enable` 버튼 |
| 권한 있음, CLI 안 붙음 | `muted-foreground` | Bridge idle | `Disable` 버튼 |
| CLI 붙음 | `live` | Bridge live | `Disable` 버튼 |

**컨트롤은 스위치가 아니라 버튼이다.** all-sites 스위치가 `permissions.request()` 를
부르지 않도록 이미 고쳐진 이유가 그대로 적용된다 — 컨트롤이 움직였다는 이유로 권한
대화상자를 띄우지 않는다.

여기서 매니페스트에 `optional_permissions: ["nativeMessaging"]` 이 들어간다.
**`tests/unit/manifest.test.ts` 가 그 값을 정확히 고정해야 한다** — 지금 그 파일은
`permissions` 와 `optional_host_permissions` 만 고정하고 `optional_permissions` 는 읽지
않는다. 그리고 설치 시점 `permissions` 는 **한 글자도 바뀌면 안 된다**.

### 3. 인스톨러

- 호스트 매니페스트를 올바른 디렉터리에 쓴다. **user-data-dir 파생**이므로 고정 경로가
  아니다: Chrome 은 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`,
  Chromium 은 `.../Chromium/...`. e2e 는 Playwright 가 만든 임시 디렉터리에 써야 한다.
- `allowed_origins` 는 **실제 로드된 확장 ID** 여야 한다. 와일드카드 불가. 계산값을
  하드코딩하지 말고 대조한다.
- **셔뱅을 절대 인터프리터 경로로 다시 쓰고, 그 다시 쓴 것을 실행해 검증한다.**
  `#!/usr/bin/env node` 는 Chrome 이 주는 환경에서 해석되지 않는다 — 스크립트가 0줄
  실행되고 확장은 `{"message":"Native host has exited."}` 만 받는다.
- **자기 출력을 스스로 검증한다.** Chrome 의 에러 문구는 매니페스트 거부 · ID 불일치 ·
  인터프리터 부재 **셋 모두에 대해 동일**하다. 확장 쪽에서 구분할 수 없다.

## 이미 값을 치른 함정들 — 다시 겪지 말 것

- **`pnpm` 이 이 기계에서 안 돈다.** corepack 이 프록시로 11.20.0 을 못 받고, homebrew
  pnpm 은 자기 전환하다 `@pnpm/exe@11.20.0` 부재로 죽는다. 래퍼:
  `.superpowers/sdd/2026-08-12-agent-bridge-packaging/pnpm`, **그 디렉터리를 PATH 앞에**
  둬야 `pnpm check` 의 중첩 호출도 탄다. `pnpm install` 은 돌리지 않는다(래퍼는 pnpm 10,
  `allowBuilds` 는 11 의 철자).
- **구현자는 한 번에 하나만.** 공유 체크아웃에 둘을 돌려 남의 미커밋 변경이 남의
  format:check 를 깼다.
- **변이 검증은 커밋 후에.** `git checkout --` 이 미커밋 작업을 두 번 날렸다.
- **동시 `unlink()` 는 정확히 한 호출자에게만 ENOENT 를 주지 않는다.** 이 파일시스템에서
  15~20% 가 둘 다 성공을 보고한다. 그 위에 세운 테스트는 되돌린 수정에 대해 가끔
  통과한다. `docs/research/2026-08-11-native-messaging-spike.md` 에 기록.
- **`node --test packages/cli` 는 그 경로를 파일로 읽는다.** 패키지 안에서 돌려야 한다.
- **`pnpm test -- <파일>` 은 필터가 안 걸린다.** 인자를 그냥 준다.
- 좀비 호스트 프로세스가 `pnpm -r test` 를 간헐적으로 깨뜨렸다. SIGTERM 으로 안 죽고
  SIGKILL 로 죽는다. 스모크 테스트 후 반드시 정리.

## 이 브랜치에서 나온 결함 열여섯 — 전부 계획 쪽, 스위트가 잡은 것 0

| 종류 | 수 |
|---|---|
| 없는 단언 | 6 |
| 실패할 수 없는 단언 | 5 |
| 브리프에 적은 사실이 틀림 | 3 |
| 존재하지만 실행되지 않는 단언 | 1 |
| 없는 문장을 문서에서 인용 | 1 |

잡아낸 것은 태스크별 리뷰 게이트, 구현자의 정지, 격리된 워크트리의 변이 심기,
`git log --all -S`, 그리고 스파이크의 실측이었다. **디스패치마다 "브리프의 사실이
재현되지 않으면 멈추고 보고하라"를 넣는 것이 셋을 잡았다.**

## 사용자 환경에 남은 정리

스파이크 확장과 호스트 매니페스트가 아직 Chrome 에 있다. 3차가 실제 호스트를 붙이므로
그 전에 치우는 편이 낫다.

```
rm "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.headerlab.spike.json"
```

`chrome://extensions` 에서 HeaderLab 제거 시 승인된 `nativeMessaging` 권한도 사라진다.

## 미결로 남긴 것

- **Q12** — 포트가 닫힌 *이유*(확장 비활성화 · 브라우저 종료 · 권한 해제)를 호스트가
  구분할 수 있는가. Q11 이 "유휴로는 안 죽는다"로 답하면서 값이 내려갔다. 필요해지면
  확장이 끊기 전에 이유를 포트로 내려보내는 것이 유일한 방법이다.
- **packed 빌드의 `alarms` 주기** — `alarms` 를 쓰지 않기로 해서 지금은 안 걸린다.
- **CLI 의 npm 발행 여부** — 지금 `private: true`. 프록시 문제가 걸리므로 별도 결정.
- `packages/cli` 가 `packages/host` 를 선언 없이 임포트한다. 둘 다 `private: true` 인
  동안은 무해하나, 발행하면 문제가 된다.
- 플러그인의 `bin/headerlab` 심이 `packages/cli` 를 형제로 가정한다. 두 에이전트가
  설치하는 트리에서 그 가정이 맞는지 확인되지 않았다. SKILL.md 의 preflight 가
  틀렸을 때 우아하게 실패시키므로 "확인하고 적기"이지 결함은 아니다.

## 다음 한 걸음

3차 계획을 `docs/superpowers/plans/` 에 쓰고, subagent-driven-development 로 실행한다.
설계 논쟁은 남아 있지 않다 — 위의 실측이 필요한 사실을 다 담고 있다.
