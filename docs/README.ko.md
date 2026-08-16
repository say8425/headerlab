# HeaderLab

[English](../README.md) | 한국어 | [日本語](README.ja.md) | [中文](README.zh.md) | [Español](README.es.md)

HTTP 요청·응답 헤더를 Chrome 에서 추가·수정·삭제합니다. 사용자가 허용하기 전까지 어떤
사이트 접근 권한도 갖지 않습니다.

[![CI](https://github.com/say8425/headerlab/actions/workflows/ci.yml/badge.svg)](https://github.com/say8425/headerlab/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/headerlab?logo=npm&logoColor=%23CC3534&color=%23CC3534)](https://www.npmjs.com/package/headerlab)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4?style=flat&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](#라이선스)

ModHeader 를 대체합니다. ModHeader 는 2026년 7월 숨겨진 트래커가 발견되어 Chrome 웹
스토어에서 내려갔습니다. 이것이 이 프로젝트가 존재하는 이유 전부이고, 아래 신뢰
원칙이 기능 목록이 아니라 하드 제약인 이유입니다.

| 라이트 | 다크 |
|---|---|
| ![라이트 테마의 HeaderLab 팝업: 룰 네 개 중 셋이 동작 중, 허용된 사이트 둘, 헤더 룰 넷](screenshots/popup-light.png) | ![같은 팝업의 다크 테마. 운영체제 설정을 따릅니다](screenshots/popup-dark.png) |

## 설치

Chrome 웹 스토어 등록은 없습니다. 최신
[릴리즈](https://github.com/say8425/headerlab/releases)에 첨부된 zip 을 받아 풀거나,
직접 빌드하세요:

```bash
corepack enable          # pnpm 은 package.json 의 packageManager 필드에서 옵니다
pnpm install
pnpm build               # → .output/chrome-mv3
```

그다음 `chrome://extensions` 를 열고 **개발자 모드**를 켠 뒤 **압축해제된 확장 프로그램을
로드합니다**를 눌러 그 디렉터리를 고르면 됩니다. Chrome 전용입니다 —
[한계](#한계)를 보세요.

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

## 에이전트 브리지

AI 에이전트가 사람이 팝업을 클릭하는 대신 터미널에서 HeaderLab 을 조작할 수 있습니다:

```bash
headerlab site add staging.example.com
headerlab rule add --target request --op set --name Authorization --value "Bearer $TOKEN"
```

터미널에서는 사람이 읽을 출력을, 파이프로 넘기거나 `--json` 을 주면 성공이든 실패든
JSON 객체 하나를 찍습니다. `--human` 은 `--json` 의 반대입니다: 파이프로 넘겨도 사람이
읽을 형태를 강제합니다. 기계가 아니라 사람이 읽을 로그를 남길 때 쓰는 것입니다. 둘을
함께 주는 것은 우선순위 문제가 아니라 모순이므로, CLI 는 아무것도 하지 않고 거부하며
2 로 끝냅니다. 종료 코드가 실패의 종류를 이름 짓습니다:

| 종료 코드 | 뜻 |
|---|---|
| `0` | 성공 |
| `2` | 당신의 입력 — CLI 가 스스로 거부했고 아무것도 기계 밖으로 나가지 않았습니다 |
| `3` | 말을 걸 브리지가 없습니다 |
| `4` | 연결은 됐으나 교환이 실패했습니다 |
| `1` | 확장이 요청을 거부했습니다 |

```
CLI (headerlab)                      Native host              Extension (SW)
node, zero deps                       node, zero deps          lib/bridge/
   │                                      │                        │
   │  unix socket                         │  stdio                 │
   │  <per-user tmp>/headerlab/…sock      │  (4-byte length + JSON)│
   └──────── one JSON line ──────────────►├───────────────────────►│
            request/response              │                    apply()
   ◄──────────────────────────────────────┤◄───────────────────────┤
                                          │                   local:state
                                          │                        ▼
                                     Chrome launches         reconcile()
                                     and kills it        (existing single loop)
```

**이 다이어그램이 나르려는 단 하나의 사실은 방향입니다: 호스트는 확장에게 먼저 말을 걸 수
없습니다.** Chromium 에 네이티브가 먼저 연결하는 경로가 있기는 하지만 기본으로 꺼진 플래그
뒤에 있어서, 설계는 확장을 유일한 개시자로 취급합니다. 확장이 포트를 열면 그 부수효과로
Chrome 이 호스트 프로세스를 띄우고, 호스트가 유닉스 소켓을 열고, 거기에 붙는 것이 CLI 입니다
— 반대 방향은 없습니다. 쓰기는 JSON 한 줄로 들어와 stdio 위에서 프레이밍되어 확장으로
건너가고, `local:state` 에 적용되어, 다른 모든 트리거가 이미 모여드는 그 `reconcile()` 이
집어갑니다: **새 트리거이지 새 writer 가 아닙니다.**

### 명령

넷은 읽기만 하고 아무것도 바꾸지 않습니다: `status`, `site ls`, `rule ls`, `state get`.
질의 하나를 보내고 팝업이 그리는 것과 **같은 순수 함수**로 답하므로, CLI 가 말하는 것과
레일이 보여주는 것이 갈라질 길이 없습니다.

```bash
headerlab status
headerlab state get --json | jq .state | headerlab state set - --force
```

`status` 는 브리지가 없다는 것을 에러가 아니라 사실로 다루는 유일한 명령입니다 — 로컬에
설치된 것만으로 답하고 `live: false` 라고 말한 뒤 exit 0 으로 나갑니다. 커밋이 없는
저장소에서 `git status` 가 동작하는 방식과 같습니다. 나머지 셋은 3 으로 나갑니다.

아홉 개가 쓰기로서 브리지 소켓을 지납니다: 룰 셋의 범위를 정하는 `site add|rm` 과
`site all-sites on|off`, 헤더 룰을 편집하는 `rule add|rm|toggle`, 전체를 멈추고 다시
켜는 `pause`/`resume`, 그리고 저장된 상태를 통째로 갈아끼우는 `state set <file|->` —
마지막 것은 stdin 이 터미널이 아닐 때 `--force` 를 요구합니다. 되돌릴 수 없는
덮어쓰기이기 때문입니다.

나머지 셋은 그 소켓을 아예 건드리지 않습니다 — 네이티브 메시징 호스트 매니페스트와 Chrome
이 실행하는 런처 스크립트를 관리하며, 애초에 소켓을 가능하게 만드는 것이 그것입니다:
`bridge install`, `bridge uninstall`, `bridge status`. 마지막 것은 런처가 가리키는 파일이
사라졌을 때 `entryMissing` 을 보고합니다 — `npm uninstall -g headerlab`, 업그레이드,
또는 전역 prefix 를 옮기는 nvm 전환의 증상입니다. `bridge install` 을 다시 돌리면 고쳐집니다.

플래그와 오류 코드까지의 전체 레퍼런스는
[`packages/plugin/skills/headerlab/SKILL.md`](../packages/plugin/skills/headerlab/SKILL.md)
에 있습니다.

### 오해하면 안 되는 다섯 가지

제품 자신의 주장입니다. 여기서 틀리는 것은 이 절을 아예 빼는 것보다 나쁩니다.

- **사람이 켜기 전까지 브리지는 꺼져 있습니다.** `nativeMessaging` 을 선택적 권한으로 타고,
  팝업의 버튼에서 요청되며, Chrome 자신의 동의 대화상자 뒤에 있습니다 — 설치 시점의
  `permissions` 목록은 바뀌지 않습니다. 추정이 아니라 측정입니다:
  [`docs/research/2026-08-11-native-messaging-spike.md`](research/2026-08-11-native-messaging-spike.md)
  가 동의 대화상자가 실제로 뜨는 것과, 두 번째 연결에서는 대화상자 없이 권한이 유지되는 것을
  기록합니다.
- **CLI 는 사이트 권한을 줄 수 없습니다.** `site add` 와 `site all-sites on` 은 룰이 무엇에
  *범위 지정*되는지만 바꿉니다 — 그 행은 사람이 **Grant** 를 누를 때까지 손으로 추가한
  사이트와 똑같이 대기 상태로 남습니다. Chrome 이 권한 부여에 사용자 제스처를 요구하고,
  그 제약을 우회하지 않고 지킵니다.
- **CLI 는 브리지도 켤 수 없습니다.** `chrome.permissions.request()` 는 해결되려면 사용자
  제스처를 요구합니다. `headerlab bridge enable` 은 없고, 앞으로도 동작하는 형태로는 생기지
  않습니다: 아무도 **Enable** 을 누르지 않은 브리지 옆의 `bridge install` 은 연결되지 않을
  파일을 쓸 뿐입니다.
- **기기 밖으로 나가는 것은 없습니다.** CLI·호스트·확장은 권한이 제한된 사용자별 디렉터리의
  유닉스 도메인 소켓으로만 이야기하며, 네트워크 소켓은 쓰지 않습니다. **`$TMPDIR` 이
  아니고**, 그건 의도입니다: `socketDir()` 은 각 프로세스가 물려받은 `$TMPDIR` 을 읽는 대신
  OS 에 묻습니다(`getconf DARWIN_USER_TEMP_DIR`, 절대 경로로). 호스트는 Chrome 의 환경을,
  CLI 는 터미널의 환경을 물려받아서, 두 사본이 어긋나도 그것을 드러낼 실패가 없기
  때문입니다. 이를 덮어쓰는 변수가 하나 있고(`HEADERLAB_SOCKET_DIR`), 그것은 호출부가
  각자가 아니라 함수 *안에서* 한 번 읽힙니다 — 같은 이유로요.
  `tests/unit/outbound.test.ts` 가 `packages/headerlab/` 아래 모든 `.mjs` 에서 바깥으로
  나가는 프리미티브 — `fetch`, `WebSocket`, `node:https`, `.listen(<포트번호>)` 호출 — 를
  금지하며, 자기 독블록이 못 보는 것을 스스로 밝힙니다: 포트 검사는 소스의 리터럴 숫자에
  매칭되므로 `server.listen(8080)` 은 잡히고 `server.listen(tcpPort)` 는 안 잡힙니다.
  암묵에 맡기지 않고 적어 둔 것은, 보안 보증을 과장하는 것이 이 저장소가 가장 하기 싫은
  일이기 때문입니다.
- **이 빌드는 regex 필터를 거절합니다.** `state set` 은 페이로드를 검증하지만, 팝업에는
  regex 편집기가 없고 여기서 `chrome.declarativeNetRequest.isRegexSupported()` 를 부르는
  곳도 없습니다 — 패턴이 유효한 RE2 인지에 대한 유일한 권위입니다. 그러니
  `filter.mode: 'regex'` 룰은 보이지 않게 적용되어, 어떤 화면도 책임 있는 패턴을 보여줄 수
  없는 채로 헤더가 바뀔 것입니다. `lib/bridge/port.ts` 가 그런 페이로드를 오류 코드
  `unsupported` 로 곧바로 거절합니다 — 함께 갈 regex 편집기가 생길 때까지
  ([#33](https://github.com/say8425/headerlab/issues/33)).

### 켜는 법

1. 팝업의 브리지 행에서 **Enable** 을 누릅니다 — 그전까지는 **Bridge off** 로 읽힙니다.
   이것이 Chrome 자신의 동의 대화상자를 통해 `nativeMessaging` 권한을 요청합니다.
2. `chrome://extensions` 에서 id 를 복사해 설치 명령을 실행합니다:

   ```bash
   headerlab bridge install --extension-id <id>
   ```

3. 팝업이 **Bridge live** 를 읽습니다.

`--extension-id` 는 CLI 자신의 README 도 앞세우는 지시입니다. 언제나 적용되는 쪽이기
때문입니다 — npm 으로 CLI 를 설치한 사람에게는 가리킬 확장 디렉터리가 없습니다.
`--load-path <dir>` 는 로컬 압축해제 빌드로 작업 중이라 경로가 이미 손에 있을 때의
대안인데, 편의만큼이나 함정입니다: 심링크, 끝의 슬래시, 또는 같은 디렉터리를 다르게 쓴 경로가
각각 다른 id 로 해시되고, 어긋난 매니페스트는 깨끗하게 설치된 뒤 그냥 연결되지 않습니다.

어느 쪽이든 설치기는 자기가 쓴 id 를 그대로 되돌려줍니다. CLI 안의 어떤 것도 그것을 Chrome
이 실제로 로드한 것과 대조할 수 없기 때문입니다. 되돌려받은 id 를 `chrome://extensions` 와
비교하는 것이 존재하는 유일한 검사이고, `tests/e2e/bridge.spec.ts` 가 실행 중인 브라우저를
상대로 정확히 그것을 합니다.

**패키징.** `packages/headerlab` 은 `headerlab` 명령**과** Chrome 이 띄우는 호스트를 둘이
아니라 하나의 패키지로 배포합니다. `bridge install` 은 호스트의 진입 파일을 절대 경로로
이름 짓는 런처를 쓰는데, 호스트 없이 발행된 CLI 도 그 런처를 씁니다 — 설치 단계는 자기가
이름 붙인 파일이 대상 기계에 없다는 것을 볼 수 없습니다 — 그리고 Chrome 은 그 실패를 거절된
매니페스트나 어긋난 id 와 똑같은 메시지로 보고합니다. 하나의 tarball 에서 둘 다 배포하면
그 실패 양상이 문서가 아니라 구조로 불가능해집니다.

설계 자신의 §2/§3 이 이름 붙인 것 중 둘은 여전히 없습니다: `headerlab diagnostics` 는
앞으로도 만들지 않습니다 — `status` 가 같은 페이로드를 나르고, 질의 하나에 이름 둘은
기능이 아닙니다 — 그리고 `state snapshots`/`state restore <id>` 가 읽어갈, 모든 raw
쓰기 전의 스냅샷도 없습니다 ([#35](https://github.com/say8425/headerlab/issues/35)).
`state set` 은 스키마 검증을 하고 `--force` 를 요구하지만, 이력은 남기지 않습니다.

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
[#34](https://github.com/say8425/headerlab/issues/34) 수동 테마 토글 ·
[#35](https://github.com/say8425/headerlab/issues/35) 브리지의 남은 명령들.

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
```

**npm 이 아니라 pnpm.** `package.json` 의 `packageManager` 가 정확한 버전을 지정하므로
`corepack enable` 하나면 그 버전이 오고 따로 설치할 것이 없습니다. `package-lock.json`
은 없습니다. `pnpm-lock.yaml` 이 CI 가 `--frozen-lockfile` 로 설치하는 락파일입니다.

**`pnpm exec vitest run` 을 맨손으로 돌리지 말고 `pnpm test` 를 쓰세요.** 여러 스위트가
*빌드된* 산출물에 대해 단언하는데 맨손 도구는 빌드를 하지 않습니다. 낡은 산출물이 가드를
조용히 무력화한 가짜 초록과 한 시간을 태운 가짜 빨강을 둘 다 만들어낸 적이 있어서,
`tests/support/build.ts` 가 낡음을 감지하고 실행할 명령과 함께 실패합니다.

**`pnpm test:e2e` 와 `pnpm screenshots` 는 Playwright 가 기본으로 설치하지 않는 브라우저를
필요로 합니다:**

```bash
pnpm exec playwright install --with-deps --no-shell chromium
```

`--no-shell` 이 중요합니다. Playwright 의 기본 헤드리스 다운로드는
`chromium-headless-shell` 이고, 이것은 확장을 로드할 수 없는 축약 빌드입니다 — 그런데 저
두 명령은 확장을 로드하려고 존재합니다. 전체 바이너리가 없으면 의존성 누락이 아니라 코드
문제처럼 보이는 방식으로 실패합니다.

**`pnpm screenshots` 는 추적 중인 PNG 를 덮어씁니다** (`docs/screenshots/`). 그게 그 명령의
일이지만, 한 번 돌리면 `git status` 에 변경이 남습니다 — UI 가 실제로 바뀌었을 때만
커밋하세요.

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
로드된 확장에 대한 종단간. 열여섯 개 e2e 중 둘은 로컬 에코 서버를 통해 실제 요청을 회선에
올리고 헤더를 되읽습니다 — 이 저장소에서 가장 강한 증거입니다.

작성 시점: 파일 38개에 걸친 단위 테스트 820개와 e2e 16개. 그중 넷은 브리지 자신의 것이고,
실제 `headerlab site add` 를 실제 설치된 호스트와 소켓을 거쳐 실제 저장소까지 밀어 넣는
것이 포함됩니다. `packages/headerlab` 은 140개를 더 들고 있으며, vitest 가 아니라 Node
내장 테스트 러너로 돌립니다. 그 패키지는 의존성이 없고 얻어서도 안 되기 때문입니다.
`vitest.config.ts` 의 glob 이 거기에 닿지 못하는데, 그것이 자체 CI 잡을 갖는 이유입니다.
한동안 실행되지 않은 채 머지되고 있었고, 아무것도 돌리지 않는 스위트는 없는 것보다 나쁩니다.
성공을 보고하기 때문입니다.

## 라이선스

Apache-2.0. [LICENSE](../LICENSE) 를 보세요.
