# HeaderLab

[English](../README.md) | 한국어 | [日本語](README.ja.md) | [中文](README.zh.md) | [Español](README.es.md)

HTTP 요청·응답 헤더를 Chrome 에서 추가·수정·삭제합니다. 사용자가 허용하기 전까지 어떤
사이트 접근 권한도 갖지 않습니다.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/kgapijlldieckifoenckgninnepafhnn?logo=googlechrome&logoColor=%234285F4&color=%234285F4&label=chrome%20web%20store)](https://chromewebstore.google.com/detail/headerlab/kgapijlldieckifoenckgninnepafhnn)
[![CI](https://github.com/say8425/headerlab/actions/workflows/ci.yml/badge.svg)](https://github.com/say8425/headerlab/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/headerlab?logo=npm&logoColor=%23CC3534&color=%23CC3534)](https://www.npmjs.com/package/headerlab)

| 라이트 | 다크 |
|---|---|
| ![라이트 테마의 HeaderLab 팝업: 룰 네 개 중 셋이 동작 중, 허용된 사이트 둘, 헤더 룰 넷](screenshots/popup-light.png) | ![같은 팝업의 다크 테마. 운영체제 설정을 따릅니다](screenshots/popup-dark.png) |

## 설치

**[Chrome 웹 스토어에서 설치하기](https://chromewebstore.google.com/detail/headerlab/kgapijlldieckifoenckgninnepafhnn)**
— Google 의 검토를 거쳤고, 자동으로 업데이트되며, 우선할 경로입니다. Chrome 전용입니다 —
[한계](#한계)를 보세요.

또는 릴리즈의 빌드를 받으세요.
[릴리즈 페이지](https://github.com/say8425/headerlab/releases)의 `extension-v*` 태그마다
`headerlab-<version>-chrome.zip` 이 첨부되며, 그 태그를 자른 것과 같은 워크플로 실행이
빌드한 것입니다. 압축을 풀고 `chrome://extensions` 를 연 뒤 **개발자 모드**를 켜고
**압축해제된 확장 프로그램을 로드합니다**를 눌러 그 디렉터리를 고르세요.

또는 직접 빌드하세요. 아래의 신뢰 원칙을 말로만 두지 않고 확인할 수 있게 만드는 것이 바로
이것입니다 — 이 페이지의 어느 것도 당신이 직접 빌드하지 않은 릴리즈를 믿으라고 하지
않습니다:

```bash
corepack enable          # pnpm 은 package.json 의 packageManager 필드에서 옵니다
pnpm install
pnpm build               # → .output/chrome-mv3
```

## AI

HeaderLab 은 AI 코딩 에이전트로 조작할 수 있습니다. 서로 포개지는 세 조각입니다 — 사람이
직접 손으로 쓸 수도 있는 CLI, 에이전트에게 그것을 쓰는 법을 가르치는 스킬, 그리고 그 둘 중
어느 쪽이든 실행 중인 확장에 연결하는 브리지. 어느 것도 기본으로 켜져 있지 않고, 어느 것도
스스로를 켤 수 없습니다 — 그 이유는 이 절의 마지막 문단에 있습니다.

### CLI

```bash
npm i -g headerlab
```

터미널에서 확장을 조작하기 위한 `headerlab` 명령이 PATH 에 놓입니다 —
[에이전트 브리지](#에이전트-브리지)를 보세요. 런타임 의존성이 하나도 없어서 클론에서
설치 없이 바로 실행되기도 합니다: `node packages/headerlab/bin/headerlab.mjs`. 다만 위의
한 줄이 사람이 쓰는 방법이고 클론은 기여자가 하는 일이라, 순서는 일부러 그렇게 두었습니다.

### 에이전트 스킬

`packages/plugin` 은 CLI 를 Claude Code 와 Codex 용 스킬로 포장합니다. 하나의 `skills/`
트리를 두 개의 매니페스트가 공유합니다. 어느 쪽도 디렉터리에 등록되어 있지 않으므로 둘 다
이 저장소에서 설치합니다:

```bash
# Claude Code
claude plugin marketplace add say8425/headerlab
claude plugin install headerlab@headerlab

# Codex
codex plugin marketplace add say8425/headerlab
```

스킬은 자기 내용이 모델에 닿기 전에 `command -v headerlab` 를 먼저 실행합니다. CLI 가
없다는 사실이 작업 도중의 뜻밖이 아니라 처음부터 사실로 도착하게 하기 위해서입니다.
**브리지를 켜기 전까지는 `bridge-off` 를 보고합니다.** CLI 를 전역 설치하는 것이 전제
조건은 아닙니다 — 플러그인이 `packages/headerlab` 로 가는 자체 shim 을 들고 있습니다.
`npm i -g headerlab` 를 함께 해도 충돌이 아닙니다. PATH 가 전역 사본을 먼저 찾습니다.

평소 쓰는 말로 물어보면 스킬이 그 요청을 CLI 명령으로 옮깁니다:

```text
HeaderLab 지금 뭐 하고 있어?
staging.example.com 에만 X-Debug: on 요청 헤더 추가해줘
api.example.com 에서는 Referer 헤더 보내지 마
규칙 전부 잠깐 멈췄다가 다시 켜줘
내가 실제로 수정할 수 있는 사이트가 어디야?
```

첫 줄과 마지막 줄은 읽기입니다 — `status`, `site ls`, `rule ls`, `state get` 이 아무것도
쓰지 않고 답합니다. 가운데 셋은 쓰기이고, 하나는 미리 알아두는 편이 좋습니다: 사이트를
추가하는 것은 규칙의 적용 범위를 정할 뿐 그 사이트에 대한 접근 권한을 주지는 않습니다.
팝업에서 Grant 를 누르기 전까지 그 사이트는 대기 상태로 남으며, 스킬은 이미 적용된 것처럼
넘어가지 말고 그 사실을 말하도록 지시받아 있습니다.

### 에이전트 브리지

위의 둘 중 어느 쪽이든 실행 중인 확장까지 실어 나르는 것이 브리지입니다:

```bash
headerlab site add staging.example.com
headerlab rule add --target request --op set --name Authorization --value "Bearer $TOKEN"
```

브리지는 사람이 팝업에서 스위치를 켜기 전까지 꺼져 있고, CLI 는 사이트 접근 권한을
줄 수도 브리지를 켤 수도 없습니다 — Chrome 이 둘 다 사용자 제스처에서만 받기 때문입니다.
기기 밖으로 나가는 것은 없습니다: CLI·호스트·확장은 사용자별 디렉터리의 유닉스 도메인
소켓에서 만나며, 네트워크 소켓은 쓰지 않습니다.

[`docs/agent-bridge.ko.md`](agent-bridge.ko.md) 가 그 전부입니다 — 프로토콜, 명령, 종료
코드, 켜는 법, 그리고 오해하면 안 되는 다섯 가지.

## 무엇을 하는가

- 어떤 헤더든 **요청** 쪽이든 **응답** 쪽이든 **설정·추가·삭제**합니다. `append` 는
  Chrome 이 요청 헤더 21개 허용목록으로 제한하며, HeaderLab 은 그 밖에 있는 룰을 짚어
  줍니다. 이건 들리는 것보다 중요합니다 — Chrome 은 룰셋을 룰 단위가 아니라 통째로
  거절하므로, 그런 룰 하나가 나머지 전부를 함께 멈춥니다. 이건 조용히 넘어가지 않습니다 —
  팝업이 등록 실패를 표시합니다.
- **사이트 단위 범위 지정.** 사이트는 호스트로 매칭됩니다. 포트나 경로를 넣으면 떨어져
  나가고, 저장된 값이 곧 동작하는 값이므로 레일에 보이는 것이 실제로 회선에 나가는 것입니다.
- **모든 사이트에 적용**을 빈 목록이 아니라 명시적인 모드로 둡니다. `<all_urls>` 를
  요구하지만 스위치 자체는 그것을 요청하지 않습니다 — 옆의 Grant 버튼이 합니다.
- **요청 타입으로 거르기** — Chrome 의 리소스 타입 여덟 개를 개별 체크합니다.
  `main_frame` 이 기본으로 켜져 있는데, DNR 의 기본값이 그것을 조용히 제외하기 때문입니다.
- 스위치 하나로 **전체 일시정지.** 툴바 아이콘도 회색으로 바뀌고, 서비스 워커가 깨어날 때
  다시 적용됩니다.
- **OS 테마를 따릅니다.** 라이트든 다크든 첫 페인트 전에 결정됩니다.

권한은 사이트마다, 그 사이트 이름이 적힌 행에서 요청합니다 — 호스트명을 타이핑하거나
스위치를 넘긴 부수효과로 요청하는 일은 없습니다. **Grant** 를 누르기 전까지 그 행은
호박색이고, 그렇다고 말합니다:

![internal.example.com 사이트 행이 대기 상태의 호박색으로, Grant 버튼과 함께 표시된 모습](screenshots/popup-permission.png)

룰이 나가지 못하게 막는 것은 무엇이든 그 룰 자신의 행에서 말하고, 레일에서 셉니다. 아래는
두 번째 룰이 Chrome 이 추가해주지 않을 요청 헤더에 `append` 를 요구한 경우입니다 — 행은
어떤 헤더인지와 대신 무엇을 해야 하는지를 말하고, 판독부는 **2 of 4 rules live · 1 off ·
1 blocked** 를 읽으며, 그 메시지를 위해 아무것도 자리를 옮기지 않습니다:

![두 번째 행의 값 자리에 "Use Set. Chrome does not append request headers." 가 빨간색으로 표시된 룰 목록과, 2 of 4 rules live, 1 off, 1 blocked 을 읽는 레일](screenshots/popup-blocked.png)

<sub>Chrome 에 로드된 실제 프로덕션 빌드에서 촬영했습니다. 매니페스트만 손봤는데, 예시
호스트 두 개를 미리 허용해 두어야 네이티브 권한 대화상자 없이 허용된 상태를 찍을 수 있기
때문입니다.</sub>

## 신뢰 원칙

- **설치 시점에 호스트 권한 없음.** 매니페스트의 `permissions` 는 정확히 `storage` 와
  `declarativeNetRequestWithHostAccess` 뿐입니다. `optional_host_permissions:
  ["<all_urls>"]` 도 선언하지만 그 자체로는 아무것도 부여하지 않습니다 — Chrome 은 확장이
  선언한 적 없는 오리진을 요청하는 것을 거부하므로, 그 줄은 런타임 Grant 버튼을 합법으로
  만드는 것이지 불필요하게 만드는 것이 아닙니다. 사이트 접근은 사용자가 호스트마다 런타임에
  부여하며, Chrome 에서 언제든 회수할 수 있습니다.
- **네트워크 호출 없음.** 분석, 텔레메트리, 원격 설정, 업데이트 핑 어느 것도 없습니다.
  배포되는 번들은 네트워크 프리미티브를 *호출*하지 않으며, 믿는 대신 직접 확인할 수 있습니다:

  ```bash
  pnpm build
  grep -rE 'fetch\(|XMLHttpRequest|WebSocket|sendBeacon' .output/chrome-mv3
  ```

  아무것도 나오지 않습니다. 이 패턴이 호출·생성자 형태만 잡는 것은 의도입니다. 대소문자를
  무시하고 저 단어들을 그냥 찾으면 번들에서 열여섯 번 걸리는데, 전부 호출이 아니라 문자열
  또는 식별자입니다 — React DOM 의 `prefetchDNS`, `fetchPriority`, `dns-prefetch`, 그리고
  리터럴 `"xmlhttprequest"` 와 `"websocket"` 입니다. 뒤의 둘은 declarativeNetRequest 의
  리소스 타입 이름인데, 들어온 경로가 다릅니다 — `xmlhttprequest` 는 팝업이 체크박스로
  제공하는 여덟 개 중 하나이고(거기서는 `xhr` 로 표시됩니다), `websocket` 은 저장된 상태를
  검증하는 열다섯 개짜리 리소스 타입 enum 의 원소일 뿐입니다.
  발견했을 때 들킨 거짓말이 아니라 예상된 것으로 읽히도록 여기 적어 둡니다.
- **콘텐츠 스크립트 없음.** 어떤 페이지에도 아무것도 주입하지 않습니다. 헤더는 Chrome 의
  `declarativeNetRequest` 엔진이 바꾸며, 이 엔진은 요청 내용을 확장에 넘기지 않습니다.
- **외부 리소스 없음.** CDN 도, 웹폰트도, 원격 이미지도 없습니다.
- **조용한 실패 없음.** 룰이 나가지 못하게 하는 것은 화면에 말합니다 — 없는 권한, 쓸 수 없는
  호스트명, Chrome 이 거절할 헤더 이름. 적용되지 않는 룰은 항상 이유를 말합니다.

## 한계

**이것은 Chrome MV3 빌드이고 그 외에는 아무것도 아닙니다.** `wxt.config.ts` 는 다른
타깃을 선언하지 않으며, 다른 브라우저에서 빌드를 돌려본 적이 없습니다. Edge 는 같은
엔진이라 동작해야 하지만, 아무도 스위트를 돌려본 적이 없습니다.

아래 표는 *이식했을 때 만나게 될 플랫폼 천장*이지 지원 표가 아닙니다. 이 확장이 딛고 선
API 들에 대한 [MDN 브라우저 호환성 데이터](https://github.com/mdn/browser-compat-data)를,
각 브라우저가 처음 출시한 버전으로 읽은 것입니다. Edge 열이 숫자가 아니라 `✓` 인 것은
BCD 가 `mirror` 로 기록하기 때문입니다 — Chrome 을 따라갑니다:

| | Chrome | Edge | Firefox | Safari |
|---|---|---|---|---|
| 요청 헤더 (`RuleAction.requestHeaders`) | 86 | ✓ | 113 | 16.4 |
| 응답 헤더 (`RuleAction.responseHeaders`) | 86 | ✓ | 113 | **없음** |
| 사이트별 런타임 권한 (`optional_host_permissions`) | 102 | ✓ | 128 | 15.5 |
| 탭 범위 룰 (`RuleCondition.tabIds`) | 92 | ✓ | 113 | **없음** |
| 네이티브 메시징 (`runtime.connectNative`) | 29 | ✓ | 50 | 14 (감싸는 앱) |

이 중 둘은 따로 적어 둘 값어치가 있습니다:

- **Safari 는 응답 헤더를 아예 수정할 수 없습니다.** 이 확장이 하는 일의 절반이므로,
  Safari 이식은 같은 제품을 다시 컴파일하는 것이 아니라 더 작은 다른 제품이 됩니다.
- **Safari 의 네이티브 메시징은 디스크의 호스트 매니페스트가 아니라 감싸는 macOS 앱으로
  갑니다** (Apple 이 문서화한 모델). `headerlab bridge install` 은 바로 그 매니페스트를
  쓰므로, 거기에는 설치할 대상이 없습니다.

아직 만들지 않은 기능들은 이슈로 추적합니다:
[#30](https://github.com/say8425/headerlab/issues/30) 룰 셋 하나 ·
[#31](https://github.com/say8425/headerlab/issues/31) JSON import/export ·
[#32](https://github.com/say8425/headerlab/issues/32) 탭 락 UI ·
[#33](https://github.com/say8425/headerlab/issues/33) regex 범위 지정 ·
[#34](https://github.com/say8425/headerlab/issues/34) 수동 테마 토글.

## 구조

```
lib/model/       타입, zod 스키마, 기본값, 마이그레이션          순수
lib/compile/     AppState → DNR 룰 + 진단                      순수
lib/permissions/ origins.ts, audit.ts 순수 · probe.ts 가 브라우저 호출
lib/view/        팝업 뷰모델                                   순수
lib/bridge/      protocol.ts (명령 스키마), apply.ts (리듀서),
                 query.ts (상태 → StatusPayload)                   순수
lib/storage/     state.ts, session.ts, useAppState.ts
lib/sync/        ruleSync.ts (reconcile), icon.ts
components/      팝업 UI
entrypoints/     background.ts, popup/
packages/        확장 번들 바깥의 에이전트 브리지 — headerlab
                 (CLI 와 네이티브 메시징 호스트, npm 에 공개), plugin.
                 의존성 0, node:test, 자체 CI 잡
```

**모든 정확성은 `chrome.*` 를 절대 import 하지 않는 순수 계층에 있습니다.** `compile()`
은 애플리케이션 상태 전체를 declarativeNetRequest 룰과 진단 목록으로 바꾸고, 팝업은 같은
상태에 대해 같은 함수를 돌립니다 — 그래서 화면이 말하는 것과 브라우저가 들은 것이 어긋날
수 없습니다.

**reconcile 루프는 하나.** 저장소 변경, 워커 시작, 권한 부여나 회수 — 모든 트리거가
`lib/sync/ruleSync.ts` 의 `reconcile()` 로 모이고, 이것은 처음부터 다시 컴파일해 룰셋을
통째로 갈아끼웁니다. 멱등이며, 상태가 아래로 흘러내릴 두 번째 경로는 없습니다.

이 모양은 고른 것이 아니라 강제된 것입니다: `@webext-core/fake-browser` 는
`declarativeNetRequest` 와 `permissions.*` 를 던지는 스텁으로 구현하므로 브라우저 흉내
테스트가 불가능합니다. 로직에서 브라우저를 무관하게 만드는 것이 그에 대한 답입니다.

설계 문서는 `docs/superpowers/specs/` 에, 그 뒤의 측정된 플랫폼 제약은 `docs/research/`
에 있습니다.

## 개발

```bash
pnpm dev             # WXT 개발 서버 → .output/chrome-mv3-dev 를 압축해제 로드
pnpm check           # CI 여섯 잡 중 넷: 타입체크 · 린트 · 포맷 · 단위 테스트
pnpm test            # wxt build && vitest run — 단위 테스트, 브라우저 없음
pnpm test:packages   # 에이전트 브리지 패키지들, node:test 로 — vitest 의 glob 이
                     # 닿지 않아 자체 CI 잡을 가집니다
pnpm check:all       # pnpm check && pnpm test:packages
pnpm test:e2e        # e2e 모드 둘을 빌드한 뒤 playwright test — 진짜 Chrome
pnpm typecheck       # wxt prepare && tsc --noEmit
pnpm lint            # wxt prepare && oxlint --deny-warnings   (lint:fix 로 수정)
pnpm format:check    # oxfmt --check             (pnpm format 으로 쓰기)
pnpm build           # 프로덕션 빌드 → .output/chrome-mv3
pnpm screenshots     # 이 README 의 이미지를 실제 팝업에서 다시 생성
pnpm store:assets    # 크롬 웹 스토어용 이미지 8 장을 다시 생성 → docs/store/assets/
```

**npm 이 아니라 pnpm.** `package.json` 의 `packageManager` 가 정확한 버전을 지정하므로
`corepack enable` 하나면 그 버전이 오고 따로 설치할 것이 없습니다. `package-lock.json`
은 없습니다. `pnpm-lock.yaml` 이 CI 가 `--frozen-lockfile` 로 설치하는 락파일입니다.

**`pnpm exec vitest run` 을 맨손으로 돌리지 말고 `pnpm test` 를 쓰세요.** 여러 스위트가
*빌드된* 산출물에 대해 단언하는데 맨손 도구는 빌드를 하지 않습니다. 낡은 산출물이 가드를
조용히 무력화한 가짜 초록과 한 시간을 태운 가짜 빨강을 둘 다 만들어낸 적이 있어서,
`tests/support/build.ts` 가 낡음을 감지하고 실행할 명령과 함께 실패합니다.

**`pnpm test:e2e` 와 `pnpm screenshots`, `pnpm store:assets` 는 Playwright 가 기본으로
설치하지 않는 브라우저를 필요로 합니다:**

```bash
pnpm exec playwright install --with-deps --no-shell chromium
```

`--no-shell` 이 중요합니다. Playwright 의 기본 헤드리스 다운로드는
`chromium-headless-shell` 이고, 이것은 확장을 로드할 수 없는 축약 빌드입니다 — 그런데 저
두 명령은 확장을 로드하려고 존재합니다. 전체 바이너리가 없으면 의존성 누락이 아니라 코드
문제처럼 보이는 방식으로 실패합니다.

**`pnpm screenshots` 와 `pnpm store:assets` 는 추적 중인 PNG 를 덮어씁니다** (각각
`docs/screenshots/` 와 `docs/store/assets/`, 뒤엣것은 디렉터리를 비우고 8 장을 다시
씁니다). 그게 그 명령들의 일이지만, 한 번 돌리면 `git status` 에 변경이 남습니다 — UI 가
실제로 바뀌었을 때만 커밋하세요.

**e2e 빌드는 배포 빌드에 없는 호스트 권한을 지니며, 이 페이지 첫머리의 주장을 생각하면
소리 내어 말할 값어치가 있습니다.** `pnpm test:e2e` 는 프로덕션 디렉터리 옆에
`.output/chrome-mv3-e2e` 와 `.output/chrome-mv3-bridge-e2e` 를 만듭니다. 앞의 것은
`http://127.0.0.1/*` 를 선언해(`wxt.config.ts`) Playwright 가 클릭할 수 없는 런타임
프롬프트 없이 로컬 에코 서버를 구동할 수 있게 하고, 뒤의 것은 `nativeMessaging` 을
곧바로 부여합니다. `tests/unit/manifest.test.ts` 가 둘 다 프로덕션에 닿지 않음을
단언하며, e2e 스위트를 돌려도 `.output/chrome-mv3` 는 건드리지 않습니다 — 새 프로덕션
빌드는 `pnpm build` 로 만드세요.

나머지는 `../CLAUDE.md` 가 들고 있습니다: `lint` 가 왜 `wxt prepare` 를 체인하는지,
`postinstall` 이 왜 아예 안 돌 수 있는지, oxfmt 가 무엇을 포맷하고 무엇을 안 하는지,
그리고 이미 누군가의 시간을 태운 플랫폼 함정들.

## 테스트

세 층입니다: 브라우저 없는 순수 로직, 손으로 심은 스파이로 구동하는 어댑터, 그리고 진짜로
로드된 확장에 대한 종단간. e2e 중 둘은 로컬 에코 서버를 통해 실제 요청을 회선에 올리고
헤더를 되읽습니다 — 이 저장소에서 가장 강한 증거입니다. 브리지도 자기 몫을 갖고 있고,
실제 `headerlab site add` 를 실제 설치된 호스트와 소켓을 거쳐 실제 저장소까지 밀어 넣는
것이 그중 하나입니다.

`packages/headerlab` 은 자체 스위트를 들고 있으며, vitest 가 아니라 Node 내장 테스트
러너로 돌립니다. 그 패키지는 의존성이 없고 얻어서도 안 되기 때문입니다.
`vitest.config.ts` 의 glob 이 거기에 닿지 못하는데, 그것이 자체 CI 잡을 갖는 이유입니다.
한동안 실행되지 않은 채 머지되고 있었고, 아무것도 돌리지 않는 스위트는 없는 것보다 나쁩니다.
성공을 보고하기 때문입니다.

## 라이선스

Apache-2.0. [LICENSE](../LICENSE) 를 보세요.
