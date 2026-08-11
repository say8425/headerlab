# 네이티브 메시징 스파이크: 승인·수명·환경

2026-08-11. Chrome 151.0.7922.108, macOS 26.4.1, Node 24.16.0.
확장은 `.output/chrome-mv3` 를 unpacked 로 로드. 던져버릴 호스트와 임시 팝업 버튼을
쓰고 전부 되돌렸다.

## 왜 쟀나

`docs/superpowers/specs/2026-08-11-agent-bridge-design.md` 가 두 가지 위에 서 있었고,
둘 다 소스와 문서로만 확인된 상태였다.

- **Q10** — `permissions.request({permissions:['nativeMessaging']})` 가 런타임에 실제로
  승인을 주는가. Chromium 의 `extensions_api_permissions.cc:113-114` 에
  `kFlagCannotBeOptional` 이 없다는 것은 "optional 로 선언할 수 있다"는 말이지 "요청하면
  받아진다"는 말이 아니다. 이게 거짓이면 **설치 시점 권한을 한 글자도 안 바꾼다**는 설계의
  전제가 무너진다.
- **Q11** — 열린 포트가 MV3 service worker 를 살려두는가. Chrome 문서가 자기들끼리
  어긋난다(한 페이지는 105, What's New 는 100).

덤으로 Q12(포트가 닫힌 이유를 호스트가 구분할 수 있는가)를 보려 했다.

## Q10 — 받아진다

팝업의 버튼에서 호출했더니 Chrome 의 동의 대화상자가 떴고, 허용하자 승인됐다. **두 번째
클릭은 대화상자 없이 곧장 `connectNative` 로 갔으므로 승인이 유지된다.**

설계의 전제가 살아남았다. `permissions` 는 `["storage",
"declarativeNetRequestWithHostAccess"]` 그대로 두고, `optional_permissions` 에
`nativeMessaging` 을 얹어 user gesture 뒤에서 받으면 된다.

## Q11 — 포트만으로 산다. 하트비트는 필요 없다

하트비트를 끈 채(`beat=0ms`) 두 개의 포트를 열고 **최초 echo 이후 아무 트래픽 없이**
30초마다 호스트 생존을 샘플링했다.

```
elapsed=30s   hosts_alive=2
elapsed=60s   hosts_alive=2
…
elapsed=300s  hosts_alive=2
elapsed=420s  hosts_alive=2
```

7분 동안 호스트 로그는 8줄(호스트 둘 × 시작·argv·recv·sent)에 머물렀다. 즉 살려둔 것은
트래픽이 아니라 **열려 있다는 사실 자체**다. 30초 유휴 타임아웃도, 제거된 5분 상한도 둘 다
넘겼다.

**이 스파이크 이전에 이 저장소가 갖고 있던 반대 서술은 틀렸다.** 설계 문서(`6de7589`) 21행
결정 표는 "열린 포트만으로는 SW 가 안 산다"고 적어 하트비트 + `alarms` 를 결정했다. 그런데
같은 커밋의 §8.4 본문은 이미 Chrome 공식 문서를 인용해 정반대로 — 열린 `connectNative`
포트가 MV3 SW 를 살려둔다고 — 맞게 적어 두고 있었다. 틀렸던 것은 §8.4 가 아니라 결정
표였다. 이 스파이크는 그 결정 표의 주장을 실측으로 반박하고, 본문이 이미 인용하고 있던
사실을 확인했을 뿐이다. 인용한 Chrome 문서:
https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
(2026-08-11 읽음).

**설계 변경:** 하트비트를 넣지 않는다. `alarms` 도 넣지 않는다 — 권한이 하나 준다. SW 가
실제로 죽는 경우(브라우저 재시작·확장 리로드·크래시)는 `background.ts` 가 **이미 듣고 있는**
`onStartup`·`onInstalled` 가 덮으므로, 재연결은 새 기제가 아니라 기존 배선에 얹는다.
`onDisconnect` 에 제한된 재시도만 더한다.

**한계, 그대로 적는다.** 7분은 무한이 아니다. 그리고 unpacked 로드다 — unpacked 예외는
`chrome.alarms` 스로틀에 걸리는 것이지 포트 keep-alive 와는 다른 기제라 이 측정은 유효하다고
보지만, packed 빌드에서 다시 재본 적은 없다.

## 예상하지 못했던 것 둘

조사에도 설계에도 없던 사실이 둘 나왔다. **둘 다 확장이 진짜 이유를 절대 볼 수 없다는 같은
성질을 갖는다** — spec §8.3 이 "인스톨러가 자기 출력을 스스로 검증해야 한다"고 적은 근거가
하루에 두 번 실증됐다.

### `browser.runtime.connectNative` 는 함수가 아니다

WXT 의 `browser` 래퍼가 그것을 노출하지 않는다. 관측된 것:

```
TypeError: t.runtime.connectNative is not a function
```

어댑터는 `chrome.runtime.connectNative` 를 직접 불러야 한다. 이것은 아키텍처를 거스르지
않고 오히려 확인해준다 — `lib/bridge/port.ts` 는 `chrome.` 을 만져도 되는 유일한 파일이고,
그래서 `purity.test.ts` 의 가드 목록에 **일부러** 넣지 않는다. `lib/permissions/probe.ts` 와
같은 자리다.

### Chrome 이 주는 환경에는 셸 PATH 가 없다

`#!/usr/bin/env node` 셔뱅은 해석에 실패한다. Chrome 은 호스트를 자기 환경으로 띄우고 거기엔
nvm 도 homebrew 도 없다. 결과는 **스크립트가 첫 줄도 실행하지 못하고**, 확장이 받는 것은

```
{"message":"Native host has exited."}
```

한 줄뿐이다. 호스트 로그는 두 번의 연결 시도 내내 완전히 비어 있었다. 절대 경로 셔뱅으로
바꾸자 `env -i`(환경을 완전히 비운 조건)에서도 정상 실행됐다.

이것은 spec §8.5 가 `$TMPDIR` 에 대해 이미 추론해둔 것과 **같은 뿌리**다 — 호스트는 Chrome 의
환경을, CLI 는 터미널의 환경을 물려받는다. 그때는 추론이었고 지금은 측정이다.

**인스톨러 요구사항이 하나 늘었다:** 매니페스트의 `path` 는 최소 환경에서도 실행되는 것을
가리켜야 한다. `env` 에 의존하는 셔뱅은 그것이 아니다.

**그리고 Chrome 의 에러 문구는 세 원인에 대해 동일하다** — 매니페스트 거부, 확장 ID 불일치,
인터프리터 부재. 어느 쪽인지는 확장에서 알 수 없다.

## §8.6 은 맞았고, 생각보다 나쁘다

Chrome 이 호스트에 넘기는 argv 는 정확히 이것뿐이다.

```
["<호스트 경로>", "chrome-extension://emdiklpbkfcdhnljlaikoclahpkjledp/"]
```

프로필을 식별할 것이 아무것도 없다. 그리고 spec 이 "두 프로필이면 구분 불가"라고 적은
것보다 나쁘다 — **같은 프로필에서 두 번 연결했더니 argv 가 바이트 단위로 동일한 호스트가 둘
살아 있었다.** 소켓 경로를 Chrome 이 주는 값에서 유도할 수 없다는 결정이 옳았다.

## 확장 ID 유도는 재현된다

`.output/chrome-mv3` 의 unpacked ID 를 로드 경로 바이트의 SHA-256 앞 16바이트를 `0-f` →
`a-p` 로 매핑해 계산했고, `chrome://extensions` 카드와 에러 URL 양쪽과 일치했다.

```
emdiklpbkfcdhnljlaikoclahpkjledp
```

spec 이 "옮겨 적었을 뿐 손으로 재현하지 않았다"고 단서를 달아둔 값이었다. 이제 재현됐다.
다만 인스톨러는 여전히 **계산값을 하드코딩하지 않고** 실제 로드된 ID 와 대조해야 한다 —
심링크나 철자가 다른 같은 디렉터리는 다른 ID 를 낳는다.

## 남은 것

**Q12 는 답하지 않았다.** 포트가 닫힌 이유(SW 유휴·확장 비활성화·브라우저 종료·권한 해제)를
호스트가 구분할 수 있는지는 측정하지 않았다. Q11 이 "유휴로는 안 죽는다"로 답하면서 네 경우
중 하나가 사라졌고, 나머지 셋을 가르는 것은 UI 가 이유를 말해야 할 때만 필요하다. 필요해지면
확장이 끊기 전에 이유를 포트로 내려보내는 것이 유일한 방법이다.

**packed 빌드의 `alarms` 주기**도 미측정이다. 다만 위 결정으로 `alarms` 를 쓰지 않기로 했으므로
지금은 걸리지 않는다.
