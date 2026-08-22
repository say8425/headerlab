# 에이전트 브리지

[English](agent-bridge.md) | 한국어 | [日本語](agent-bridge.ja.md) | [中文](agent-bridge.zh.md) | [Español](agent-bridge.es.md)

[HeaderLab](README.ko.md) 의 일부입니다.

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

## 명령

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

## 오해하면 안 되는 다섯 가지

제품 자신의 주장입니다. 여기서 틀리는 것은 이 문서를 아예 빼는 것보다 나쁩니다.

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
  않습니다: 아무도 스위치를 켜지 않은 브리지 옆의 `bridge install` 은 연결되지 않을
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

## 켜는 법

1. 팝업의 브리지 행에서 스위치를 켭니다 — 그전까지는 **Agent bridge off** 로 읽힙니다.
   이것이 Chrome 자신의 동의 대화상자를 통해 `nativeMessaging` 권한을 요청합니다.
2. `chrome://extensions` 에서 id 를 복사해 설치 명령을 실행합니다:

   ```bash
   headerlab bridge install --extension-id <id>
   ```

3. 팝업이 **Agent bridge live** 를 읽습니다.

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

설계 자신의 §2/§3 이 이름 붙인 것 중 둘은 만들지 않습니다. `headerlab diagnostics` 는
`status` 가 같은 페이로드를 나르고 질의 하나에 이름 둘은 기능이 아니기 때문입니다.
그리고 `state snapshots`/`state restore <id>` 가 읽어갔을, 모든 raw 쓰기 직전의
스냅샷은 2026-08-22 에 만들지 않기로 했습니다.
`state set` 은 스키마 검증을 하고 `--force` 를 요구하지만, 이력은 남기지 않습니다.
