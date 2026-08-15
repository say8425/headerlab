# HeaderLab CLI — clig.dev 재설계

2026-08-15

## 왜

`headerlab` CLI 를 [clig.dev](https://clig.dev/) 의 Command Line Interface
Guidelines 에 맞춘다. 소유자 요구.

**측정부터 했다.** clig.dev 의 전 항목을 현재 CLI 에 대고 실제로 실행해 확인했고,
각 위반 주장은 별도 에이전트가 독립적으로 재측정해 반증을 시도했다. 115개 항목 중
적합 50 · 해당없음 20 · **위반 확정 38 · 위반 주장이었으나 반증 7**.

반증된 7건 중 **둘은 이 설계가 되살린다.** `--no-input` 과 `-q`/`--quiet` 는 둘 다
"끌 프롬프트가 없다" · "억제할 비필수 출력이 없다" 는 이유로 해당없음 판정을 받았다.
정확한 판정이고, 정확히 §2·§7 이 무효화한다 — 사람용 출력과 확인 프롬프트를
도입하는 순간 두 플래그의 주어가 생긴다. 없던 것을 만들면 그것을 끄는 수단도 함께
만들어야 한다.

**한 항목은 두 에이전트가 반대로 판정했고, 그 불일치 자체가 쓸모 있었다.**
clig Basics §1("인자 파싱 라이브러리를 써라")을 한 에이전트는 위반(아홉 파서 중
넷만 `parseArgs` 를 쓴다)으로, 다른 에이전트는 적합(`node:util` 의 `parseArgs` 가
바로 그 라이브러리이고, clig 은 모든 파서에 쓰라고 요구하지 않는다)으로 판정했다.
**적합이 옳다.** 그러나 위반 쪽이 관찰한 사실 — 다섯 파서가 위치인자를 손으로
파싱한다 — 은 진짜이고, §1.1(a) 의 원인이 바로 그것이다. 규칙은 지켜지고 있으나
결함은 실재한다. 이 문서는 규칙이 아니라 결함을 고친다.

가장 큰 것 하나로 요약하면: **이 CLI 에는 도움말이 없다.** `--help` 는
`unknown-command` 로 죽는다. 아래 전부가 그 사실의 파생이다.

## 결정된 것

| 축 | 결정 | 근거 |
|---|---|---|
| 출력 기본값 | stdout 이 TTY 면 사람용, 아니면 JSON. `--json` 으로 고정 가능 | clig Output §1·§4. "프로즈가 API 가 된다" 는 기존 우려는 파이프 경로가 JSON 으로 남아 해소된다 |
| 실패 시 스트림 | 사람용 → stderr, JSON → stdout | 스트림 선택을 형식 계약의 일부로 본다 (§2.2). clig Errors 로부터의 의도적 이탈 |
| 종료 코드 | 0 · 2 · 3 · 4 · 1 (§2.3) | clig Basics §2 — 주요 실패 모드에 매핑 |
| 읽기 명령 | 프로토콜 쿼리 **하나**, 렌더 넷 | `protocol.ts` 가 이미 예고해 둔 설계 |
| 도움말 | `lib/commands.mjs` 표에서 파생 | 파서 메시지와 도움말이 어긋날 수 없게 한다 |
| 파싱 라이브러리 | 도입하지 않음 — `node:util` 의 `parseArgs` | "No new dependencies" 는 비협상. 표준 라이브러리 파서가 이미 clig Basics §1 을 충족 |
| 호환성 | 0.2.0, breaking | `0.1.2` 는 하루 된 단일 버전 |
| JSON payload | 바이트 그대로 유지 | 바뀌는 것은 기본 모드·스트림·종료 코드뿐. `--json` 소비자는 한 글자도 안 움직인다 |
| 페이저·스피너·`--plain` | 만들지 않음 | §8 에 각각의 이유 |

---

## 1. 측정된 현재 상태

명령 일곱을 실행해 스트림을 따로 받은 결과 — **전부 exit 1, stderr 전부 0바이트,
전부 stdout.**

| 호출 | exit | stdout | stderr |
|---|---|---|---|
| `headerlab --help` | 1 | `{"ok":false,…"unknown command: --help"}` | (빈) |
| `headerlab -h` | 1 | `{"ok":false,…"unknown command: -h"}` | (빈) |
| `headerlab` | 1 | `{"ok":false,…"usage: headerlab <bridge\|site\|…>"}` | (빈) |
| `headerlab --version` | 1 | `{"ok":false,…"unknown command: --version"}` | (빈) |
| `headerlab help` | 1 | `{"ok":false,…"unknown command: help"}` | (빈) |
| `headerlab sight add example.com` | 1 | `{"ok":false,…"unknown command: sight"}` | (빈) |
| `headerlab site add example.com` | 1 | `{"ok":false,…"bridge-off"}` | (빈) |

마지막 두 줄이 진단 그 자체다. **오타와 "브릿지가 꺼져 있음" 이 스크립트 입장에서
구분 불가능하다.** 둘 다 exit 1, 둘 다 stdout.

### 1.1 감사가 찾아낸, 설계 초안이 놓쳤던 것

넷은 이 설계가 반드시 고쳐야 하는 것으로 밝혀졌다. 각각 실측 증거가 있다.

**(a) `site add` / `site rm` 이 남은 argv 토큰을 전부 도메인으로 삼는다.**
검증도 플래그 검사도 없다.

```
$ headerlab site add example.com --json
  exit 0 · 브릿지 수신: {"cmd":"site.add","domains":["example.com","--json"]}
```

같은 CLI 의 `bridge status --json` 은 `Unknown option '--json'` 으로 거부한다 —
엄격함이 이미 존재하되 다섯 파서에는 없다. 이것은 **이 설계가 `--json` 을 전역
플래그로 도입하는 순간 조용한 데이터 오염 경로가 된다**: 사용자는 JSON 을 요청했다고
믿고, 저장소에는 `--json` 이라는 도메인이 앉고, `effectiveDomain` 이 그대로 저장해
`suppressionReason` 이 `unusable-site` 를 돌려주며 프로필 전체가 컴파일을 멈춘다.
종료 코드는 0 이다.

**(b) `rule add --value` 가 비밀값을 `ps` 로 흘린다.**

```
$ ps -ax -o pid,command
  68623 node …/bin/headerlab.mjs rule add --target request --op set \
        --name Authorization --value Bearer TOPSECRET123
```

헤더 값은 `Authorization`·`Cookie`·`X-Api-Key` 가 사는 곳이다. 대안 입력 경로가
없다 — `--value-file` 은 `Unknown option`. 숨은 트래커 때문에 존재하는 저장소가
사용자 토큰을 같은 머신의 모든 계정에 노출하고 셸 히스토리에 적는 것은 이
프로젝트의 자세와 정면으로 충돌한다.

**(c) `state set -` 이 터미널에서 영원히 멈춘다.** 실제 pty 로 측정: 5초 후에도
실행 중, stdout 0바이트, stderr 0바이트, 강제 종료 필요. `readStdin()` 에
`process.stdin.isTTY` 가드가 없다. clig Help §11 이 정확히 이 상황을 위한 항목이다.

**(d) Ctrl-C 가 아무 말도 안 한다.** exit 130 은 맞지만 stdout·stderr 둘 다
0바이트 — 이 CLI 가 스스로 약속한 "모든 결과는 봉투 하나" 조차 나오지 않는다.
`grep -rn "SIGINT|SIGTERM|process.on(" bin/ lib/` 에 핸들러가 없다.

**(e) 응답 없는 브릿지는 10초를 침묵한다.** 1초 간격 샘플링에서 t=1·2·3·4초 전부
0바이트, 10.08초에 `timeout` 하나. 그 사이 유일한 신호는 터미널이 안 돌아온다는 것.

**(f) stdout 파이프가 먼저 닫히면 Node 스택 트레이스 1106바이트가 stderr 로
쏟아진다.**

```
$ headerlab bridge status | true
  stderr 1106바이트 · 25줄
  node:events:487
        throw er; // Unhandled 'error' event
  Error: write EPIPE
      at afterWriteDispatched (node:internal/stream_base_commons:159:15)
      …
```

`grep -rn "stdout.on|EPIPE|uncaughtException|unhandledRejection" bin/ lib/` 에
아무것도 없다. **이 설계가 이 결함을 더 자주 터뜨린다** — §3.1 이
`headerlab state get --json | jq .state` 를 문서화하고, `jq`·`head` 로 앞부분만
읽다가 끊는 것은 정상적인 사용이다. 지금은 296바이트 응답이 파이프 버퍼에 들어가
대개 살아남지만(위 A 대조군에서 `head -c 1` 로는 재현되지 않았다), `state get` 이
버퍼를 넘기는 순간 일상이 된다. clig Output §17 과 Errors §4 를 동시에 어긴다.

---

## 2. 출력 · 스트림 · 종료 코드

### 2.1 모드

| | 사람용 | 기계용 |
|---|---|---|
| 언제 | stdout 이 TTY 이고 `--json` 이 없을 때 | stdout 이 TTY 가 아니거나 `--json` 이 있을 때 |
| 성공 | 렌더된 텍스트 → stdout | JSON 한 객체 → stdout |
| 실패 | 설명 → stderr, stdout 은 비움 | JSON 한 객체 → stdout |

에이전트와 스크립트는 파이프로 호출하므로 자동으로 기계용이 된다. 그럼에도
`packages/plugin/skills/headerlab/SKILL.md` 는 **`--json` 을 명시**하도록 고친다 —
TTY 감지에 의존하는 계약은 감지가 틀리는 날 조용히 깨진다.

### 2.2 실패 시 스트림이 갈리는 이유 (clig 로부터의 의도적 이탈)

clig Errors 는 에러를 stderr 로 보내라고 한다. 이 설계는 **기계용 모드에서만**
그것을 따르지 않고 에러 객체도 stdout 에 둔다.

그 규칙의 목적은 파싱 가능한 출력에 산문 진단이 섞이는 것을 막는 데 있다. 기계용
모드에서 `{"ok":false,…}` 는 *진단*이 아니라 **주 출력**이다 — `jq` 가 그것을
stdout 에서 받아야 지금의 계약이 바이트 그대로 유지된다. 스트림 선택을 형식 계약의
일부로 본다. clig 자신의 "Chaos" 원칙이 근거를 요구하며 허용하는 이탈이고, 이것이
그 근거다.

사람용 모드에는 이 이탈이 적용되지 않는다. 사람용 실패는 산문이므로 stderr 로 가고
stdout 은 비어 있다.

### 2.3 종료 코드

| 코드 | 뜻 | error.code |
|---|---|---|
| `0` | 성공 | — |
| `2` | 입력이 틀림 — CLI 가 스스로 거부했고 아무 데도 가지 않았다 | `usage` · `unknown-command` · `invalid-args` |
| `3` | 브릿지에 닿지 못함 | `bridge-off` · `multiple-bridges` |
| `4` | 연결은 됐으나 교환이 실패 | `timeout` · `bridge-error` · `bridge-closed` |
| `1` | 그 외 — 목적지가 요청을 거부했다 | `invalid-command` · `invalid-state` · `unknown-rule` · `unknown-domain` · `store-unreadable` · `store-unwritable` · `unsupported` · `install-failed` |

`3` 이 자기 코드를 갖는 이유는 그것이 유일하게 흔하고 조치가 명확한 실패이기
때문이다 — SKILL.md 가 통째로 한 절을 쓴다. `2` 와 `3` 이 갈리는 것이 §1 표
마지막 두 줄에 대한 답이다.

**`invalid-command` 의 두 생산자를 분리한다.** 현재 이 코드는 두 곳에서 나온다:
`bin/headerlab.mjs` 가 `state set` 의 소스를 못 읽거나·너무 크거나·JSON 이 아닐 때,
그리고 확장의 `port.ts` 가 `parseCommand` 실패 시. 전자는 사용자가 나쁜 파일을
가리킨 것이므로 `invalid-args` 로 이름을 바꾼다. 후자만 `invalid-command` 로 남는다.
한 코드에 한 뜻, 한 종료 코드.

**`headerlab status` 는 이 표의 의도적 예외다.** 브릿지가 없다는 사실은 이 명령에게
에러가 아니라 보고할 내용이므로 exit `0` 으로 그린다. 커밋 없는 저장소에서의
`git status` 와 같은 취급. 다른 어떤 명령도 이 예외를 갖지 않는다.

### 2.4 진행 표시

소켓 왕복이 로컬이라 정상 경로는 전부 clig 의 100ms 선 안에 든다. 다만 §1.1(e) 의
10초 침묵을 고친다: **1초 뒤에도 응답이 없으면 stderr 에 한 줄**
(`waiting for the extension to reply (10s timeout)…`). 사람용·기계용 어느 모드든
stdout 은 손대지 않으므로 `jq` 로 받는 쪽은 영향이 없다. TTY 가 아니면 이 줄도
내지 않는다 — clig Output §14.

### 2.5 SIGINT

핸들러를 설치해 stderr 에 한 줄(`interrupted — no command was delivered`)을 쓰고,
열린 소켓을 파기하고, `130` 으로 나간다. §1.1(d) 를 고치는 동시에 이 저장소의
"모든 결과는 뭔가를 말한다" 를 신호 경로까지 확장한다. 두 번째 Ctrl-C 는 정리를
건너뛰고 즉시 나간다 (clig Signals §2).

### 2.6 닫힌 파이프와 예상 못 한 오류

**EPIPE 는 오류가 아니라 정상 종료다.** `process.stdout` 에 `'error'` 핸들러를
달아 `EPIPE` 면 조용히 `0` 으로 나간다 — 읽는 쪽이 그만 읽겠다고 한 것이고,
`head`/`jq` 로 앞부분만 보는 것은 정당한 사용이다. 다른 코드는 다시 던진다.

**그 외 예상 못 한 예외에는 `uncaughtException` 핸들러를 단다.** stderr 에 세
줄을 낸다: 오류 한 줄, "이것은 버그다" 한 줄, 그리고 제목과 본문(버전·플랫폼·
Node 버전·명령줄)이 채워진 이슈 URL 한 줄. `1` 로 나간다. clig Errors §4·§5.

CLI 가 *의도적으로* 내는 실패(§2.3 의 17개 코드)는 이 경로로 오지 않는다. 그것들은
이미 사람이 읽을 문장으로 다시 쓰인 것이라 버그 신고를 권할 대상이 아니다 — 이
구분이 clig Errors §1 과 §4 의 차이이며, 감사는 §1 을 이미 적합으로 판정했다.

### 2.7 무엇이 바뀌었는지만 말한다

현재 모든 쓰기 명령이 **AppState 전체**를 되돌려준다 — 모든 프로필, 모든 필터,
모든 리소스 타입, 모든 규칙의 id·name·value. `site add example.com` 하나에도.
clig Output §5 는 "바뀐 것의 요약을 찍고 전부를 찍지 말라"고 한다.

**사람용 렌더가 요약하고, 기계용 봉투는 그대로 둔다.**

```
$ headerlab site add example.com
  added example.com                      ← 사람용
  2 sites now in scope · 1 awaiting permission
```

```
$ headerlab site add example.com --json
  {"ok":true,"state":{…전체…},"changed":true}    ← 지금과 바이트 동일
```

이 갈래를 택한 근거는 clig 의 그 항목이 **출력**에 관한 것이지 API 스키마에 관한
것이 아니라는 데 있다. 사람에게 AppState 를 통째로 보여주는 일은 애초에 없고,
기계용 봉투는 §11 이 지키기로 한 계약이다.

전체 상태가 쓰기 응답에 실려 있던 *원래* 이유는 읽기 명령이 없었기 때문이다 —
`SKILL.md` 가 그렇게 적고 있다. §3.1 이 읽기 명령을 만들면 그 이유는 사라지므로,
언젠가 기계용 응답에서도 상태를 뺄 수 있다. 이번에는 하지 않는다: 한 릴리즈에서
기본 모드·스트림·종료 코드를 이미 바꾸는데 payload 까지 바꾸면 `--json` 소비자에게
남는 안정적인 것이 하나도 없다.

---

## 3. 명령 표면

### 3.1 새 명령 — 읽기

| 명령 | 그리는 것 |
|---|---|
| `headerlab status` | 매니페스트·런처·live 브릿지(CLI 로컬) + 브릿지가 살아있으면 규칙 요약·스코프·진단 |
| `headerlab rule ls` | 규칙 표 — id, on/off, target, op, name→value, 문제가 있으면 그 이유 |
| `headerlab site ls` | 스코프 목록 — 도메인, all-sites 모드, 권한 대기 여부 |
| `headerlab state get` | 전체 상태. 기계용 모드에서 `{"ok":true,"state":{…}}` |

`rule ls`/`site ls` 는 `rule`/`site` 그룹이 이미 쓰는 동사 체계에 `ls` 를 더한 것이다
(clig Subcommands §3 — 객체 종류가 달라도 같은 동사).

**설계 스펙 §2·§3 이 약속한 `diagnostics` 는 만들지 않는다.** 그 내용은 `status`
안에 그대로 있다. 명령을 하나 더 두면 같은 payload 를 두 이름으로 부르는 것뿐이다.

**`headerlab status` 와 `headerlab bridge status` 는 둘 다 남는다.** 답하는 질문이
다르다 — `bridge status` 는 `--browser`/`--user-data-dir` 로 지정한 *특정 위치*에
무엇이 깔렸는지, `status` 는 지금 전체가 어떤 상태인지. `git status` 와
`git remote -v` 의 관계다. `status` 의 도움말과 사람용 출력 끝줄이 둘의 차이를 한
줄로 적어 clig Subcommands §4 의 모호함 위험을 상쇄한다.

`state get` 왕복은 파이프 하나다:

```bash
headerlab state get --json | jq .state | headerlab state set - --force
```

봉투(`{ok,…}`)를 벗기지 않는 쪽을 택했다. 모든 기계용 응답이 같은 봉투라는 것이
현재 계약이고, 명령 하나 때문에 깨면 그 예외를 영원히 설명해야 한다.

### 3.2 기존 명령의 변경

| 명령 | 변경 |
|---|---|
| `site add` · `site rm` | `parseArgs({allowPositionals:true})` 로 파싱. `--` 로 시작하는 토큰은 **거부**하며 저장하지 않는다 (§1.1(a)) |
| `rule add` | `--value-file <path\|->` 추가. `--value` 는 남되 도움말이 `ps`·셸 히스토리 노출을 명시 (§1.1(b)) |
| `state set` | 확인 절차 (§7). 소스가 `-` 이고 stdin 이 TTY 면 즉시 usage 에러 (§1.1(c)) |
| `bridge install` | `--dry-run` 추가 (§7) |
| 전부 | 전역 플래그를 그룹 파싱 **이전**에 걷어낸다 |

### 3.3 전역 플래그

`--bridge <pid>` 가 이미 쓰는 방식대로, 그룹 파싱 이전에 argv 어디서든 걷어낸다.

| 플래그 | 뜻 |
|---|---|
| `--json` | 기계용 출력으로 고정 |
| `-q`, `--quiet` | 성공 렌더를 억제. 에러는 그대로. 종료 코드가 결과를 나른다 |
| `--no-color` | 색 끄기 |
| `--no-input` | 프롬프트 금지. 프롬프트가 필요한 상황이면 어떤 플래그를 치라고 알려주며 실패 |
| `-f`, `--force` | 위험한 동작의 확인을 건너뜀 |
| `-h`, `--help` | 도움말 |
| `--version` | 버전 |
| `--bridge <pid>` | 브릿지가 여럿일 때 지정 (기존) |

전부 clig Arguments §6 의 표준 이름이다. 새 이름을 발명하지 않았다.

**`-n`/`--dry-run` 은 전역이 아니라 `bridge install` 의 플래그다.** 이 CLI 에서
파일을 쓰는 명령은 그것 하나뿐이라, 전역으로 두면 나머지 열몇 개가 전부 "이
명령에는 미리 볼 쓰기가 없다" 를 각자 말해야 한다. 쓰기가 하나면 플래그도 거기 산다.

### 3.4 `bridge-off` 이 다음 명령을 알려준다

현재 메시지는 `no bridge is running` 이 전부다. 이것은 소켓을 쓰는 모든 명령이
누군가 Enable 을 누르고 설치를 돌리기 전까지 착지하는, **가장 흔한 실패**인데
`headerlab bridge status` 도 `headerlab bridge install` 도 이름을 대지 않는다.
clig Output §9.

```
no bridge is running.
  headerlab bridge status                     see what is installed
  headerlab bridge install --extension-id <id>   if the manifest is missing
Then open the HeaderLab popup and press Enable on the bridge row — the CLI
cannot do that step.
```

사람용 모드에서만 이 세 줄을 낸다. 기계용 봉투의 `error.message` 는 첫 문장으로
유지한다 — 여러 줄 메시지는 파싱하는 쪽에 새 부담이고, 다음에 칠 명령은 이미
`SKILL.md` 가 에이전트에게 가르치고 있다.

---

## 4. 읽기 프로토콜 (확장 쪽)

`lib/bridge/protocol.ts` 가 이미 이 설계를 예고했다:

> Read commands (`state get`, `status`, `diagnostics`) are not here. They don't
> change state, so they can call `compile()` and `ruleTally()` directly — there
> is no reason to route them through the reducer. **This schema is the list of
> writes.**

그대로 따른다. 리듀서(`apply()`)는 한 줄도 바뀌지 않는다.

### 4.1 `querySchema`

`commandSchema` 옆에 나란히 둔다. 모양은 **하나**다.

```ts
export const querySchema = z.discriminatedUnion('cmd', [
  z.object({ cmd: z.literal('status') }),
]);
```

렌더 넷이 전부 이 하나를 먹는다. 나중에 읽기 명령을 더 붙이려면 CLI 쪽 렌더만
추가하면 되고 프로토콜은 안 건드린다.

### 4.2 `lib/bridge/query.ts` — 새 순수 모듈

```ts
export interface StatusPayload {
  state: AppState;
  /** resolveSingleProfile 이 고른 것. 저장소가 비어 있으면 null */
  profile: Profile | null;
  /** compile(state).diagnostics 를 routeDiagnostics 로 가른 것 */
  diagnostics: { byRow: [string, Diagnostic[]][]; byHost: [string, Diagnostic[]][]; scope: Diagnostic[] };
  tally: RuleTally | null;
  /** scopingHosts(profile.filter) — filter.domains 가 아니다 */
  scopingHosts: string[];
  suppression: SuppressionReason | null;
  requiredOrigins: string[];
  globalPause: boolean;
}

export function status(state: AppState): StatusPayload;
```

**기존 순수 함수만 호출하고 어떤 판단도 다시 구현하지 않는다** —
`compile`(`lib/compile/compile.ts`), `routeDiagnostics`·`ruleTally`
(`lib/view/rules.ts`), `resolveSingleProfile`(`lib/view/singleProfile.ts`),
`scopingHosts`·`suppressionReason`. 팝업이 화면을 그릴 때 쓰는 바로 그 함수들이라
CLI 와 팝업이 같은 사실을 두 방식으로 계산하는 일이 생기지 않는다. 이 저장소에서
가장 비쌌던 결함이 "한 술어를 네 번 구현하고 갈라진 것"이었다.

`Map` 을 배열 쌍으로 직렬화하는 이유는 소켓을 JSON 으로 건너야 하기 때문이다.
변환은 이 파일 안에서 한 번만 일어난다.

`tally` 가 `null` 인 경우는 `profile` 이 `null` 일 때뿐이다 —
`ruleTally` 는 `profileId` 를 요구하므로 프로필 없이는 계산 자체가 성립하지 않는다.

**`tests/unit/purity.test.ts` 의 손으로 적은 목록에 `lib/bridge/query.ts` 를
이름으로 추가해야 한다.** `lib/bridge/` 에는 디렉터리 규칙이 없다 — 같은 디렉터리의
`port.ts` 가 어댑터라서 규칙을 걸 수 없기 때문이다. 추가하지 않으면 이 파일은
가드 없이 남는다.

### 4.3 `port.ts` 의 분기

`handleMessage` 가 `querySchema` 를 먼저 시도하고, 맞으면 `query.status()` 를 호출해
답한다. 안 맞으면 지금처럼 `parseCommand` 로 간다. 읽기는 `loadState()` 는 하되
`setState()` 를 하지 않으므로 `patchBridgeStatus({lastCommandAt})` 도 쓰지 않는다 —
읽기는 명령이 아니다.

`loadState()` 가 `valid:false` 를 주는 경우 읽기도 `store-unreadable` 로 답한다.
검증에 실패한 바이트를 사람에게 상태라고 보여주는 것은 이 저장소가 금지하는
"닿을 수 없는 것을 보여주기" 다.

---

## 5. 도움말은 데이터에서 나온다

현재 `lib/args.mjs` 는 usage 문자열을 **12군데에 하드코딩**한다
(`'site all-sites needs "on" or "off"'`, `'rule rm needs an id'`, …). 도움말을 따로
손으로 쓰면 파서와 어긋나고, 어긋난 것을 아무것도 잡지 않는다.

`lib/commands.mjs` 에 명령표를 순수 데이터로 두고 **넷이 전부 거기서 파생**된다:

1. `--help` / `-h` 의 최상위 도움말
2. `help <cmd>` 와 `<cmd> --help` 의 명령별 도움말
3. `lib/args.mjs` 가 내는 에러 메시지의 usage 줄
4. 오타 제안의 후보 집합

표의 한 항목은 그룹·서브명령·위치인자·플래그·한 줄 요약·예제를 갖는다. 테스트가
표와 파서의 대응을 강제한다 (§10).

### 5.1 최상위 도움말

```
headerlab — drive the HeaderLab Chrome extension's header rules from a terminal

USAGE
  headerlab <command> [flags]

EXAMPLES
  headerlab status                          what is set up right now
  headerlab site add example.com            scope the rules to a site
  headerlab rule add --target request --name X-Debug --value 1
  headerlab state get --json | jq .state    read the whole state

COMMANDS
  status                             what is installed, live, and configured
  site     add rm ls all-sites       which sites the rules apply to
  rule     add rm ls toggle          the header rules themselves
  pause | resume                     stop and restart header modification
  state    get set                   read or replace the whole stored state
  bridge   install uninstall status  the native-messaging host manifest

FLAGS
      --json       machine-readable output (the default when not a terminal)
  -q, --quiet      errors only
      --no-color   disable colour (also honours NO_COLOR, TERM=dumb)
  -h, --help       this help, or a command's help
      --version    print the version
      --bridge <pid>  pick a bridge when more than one is running

The CLI cannot turn the bridge on — a person must press Enable in the popup.
Run `headerlab help bridge` for why.

Report a problem: https://github.com/say8425/headerlab/issues
```

예제가 먼저(clig Help §6), 흔한 플래그가 먼저(§8), 지원 링크(§4)와 제보 경로(§12).

### 5.2 오타 제안

Levenshtein 거리 ≤ 2 이고 후보 길이의 40% 이하일 때만 제안하며, 최대 하나만 낸다.

```
$ headerlab sight add example.com
  unknown command: sight
  did you mean "site"?          exit 2
```

손으로 짠 순수 함수(약 15줄)라 의존성이 늘지 않는다.

### 5.3 도움말은 에러가 아니다

맨손 `headerlab` 과 `--help`·`-h`·`help <cmd>` 는 stdout 에 도움말, **exit 0**.
도움을 청하는 것은 실패가 아니다. 반대로 `headerlab site` 처럼 *틀리게* 친 것은
stderr 에 에러와 그 그룹의 usage, **exit 2**.

`--help` 는 전역 플래그이므로 그룹 파싱 이전에 걷힌다 — 따라서
`headerlab bridge install --help` 도 동작한다. 현재는 `unknown bridge command:
--help` 로 죽는다.

---

## 6. 색

정보만 나른다. 경로는 dim, 에러 red, 권한 대기 amber, live green. 그 외에는 색이
없다.

다음 중 **하나라도** 참이면 끈다: **그 스트림이** TTY 가 아님 · `NO_COLOR` 가
설정됨(값 무관) · `TERM=dumb` · `--no-color` · `HEADERLAB_NO_COLOR`.
`FORCE_COLOR` 는 되켠다. clig Output §13 의 목록 그대로이며 앱 접두 변수까지
포함한다.

**판정은 스트림마다 따로 한다.** 사람용 실패는 stderr 로 가므로(§2.1), 색을
stdout 의 TTY 여부로만 결정하면 `headerlab status > out.txt` 가 화면에 남는 에러를
흑백으로 만들고, `headerlab status 2> err.txt` 는 파일에 이스케이프 문자를 적는다.
`output.mjs` 가 `process.stdout.isTTY` 와 `process.stderr.isTTY` 를 따로 읽는다.

**이모지와 체크마크는 쓰지 않는다.** 상태 칸이 이미 `installed`·`not running` 이라는
단어로 뜻을 나른다. 글리프는 그 위에 얹는 장식이고 폰트 폴백 문제만 떠안는다.
clig 은 기호를 권하지만 그 근거는 정보 밀도이며, 여기서는 단어가 이미 그 일을 한다.

ANSI 이스케이프는 손으로 적는다(약 10개 상수). 의존성 없음.

---

## 7. 위험한 동작과 대화형

### 7.1 `state set` 은 되돌릴 수 없는 전체 덮어쓰기다

| 맥락 | 동작 |
|---|---|
| stdin 이 TTY 이고 소스가 파일 | `This replaces 3 rules and 2 sites. Continue? [y/N]` |
| `-f` / `--force` | 프롬프트 없이 진행 |
| 비대화형 (파이프·에이전트·`state set -`) | **`--force` 를 요구하며 실패**, exit 2 |
| `--no-input` | 프롬프트 대신 `--force` 를 치라는 메시지와 함께 실패, exit 2 |

마지막 두 줄이 이 설계에서 가장 논쟁적이며 **현재 스킬의 `state set` 호출을 전부
깨뜨린다.** clig Interactivity §2 가 "물어볼 수 없으면 어떤 플래그를 치라고 알려주며
실패하라" 고 명시하고, 대안(비대화형이면 조용히 진행)은 확인이 사람에게만 걸리고
스크립트에는 안 걸리는 결과가 된다 — 스크립트가 훨씬 더 많은 상태를 훨씬 더 빨리
지운다. `SKILL.md` 를 함께 고쳐 `--force` 를 명시하게 한다.

프롬프트를 도입하므로 `--no-input` 이 적용 대상이 된다 (감사가 현재는 해당없음으로
반증한 항목).

### 7.2 `state set -` 이 TTY 를 만나면

즉시 usage 에러, exit 2:
`state set - reads JSON from stdin; pipe it in or pass a file path`.
멈추지 않는다 (§1.1(c), clig Help §11).

### 7.3 `bridge install --dry-run`

계산된 확장 id, 쓸 두 경로(매니페스트·런처), 매니페스트 본문을 출력하고 **아무것도
쓰지 않는다**. 이것은 장식이 아니라 알려진 함정의 해독제다 — `--load-path` 에서
계산한 id 가 Chrome 이 실제로 부여한 id 와 다르면 설치는 깨끗이 성공하고 브릿지는
영원히 연결되지 않으며, Chrome 은 매니페스트가 아예 없을 때와 같은 메시지를 낸다.

### 7.4 비밀값

`rule add --value-file <path|->` 를 추가한다. `--value` 는 남기되 도움말이 명시한다:
*the value lands in `ps` output and your shell history — use `--value-file` for
secrets.* `state set -` 이 stdin 배관이 이미 있다는 증거다 (§1.1(b),
clig Arguments §14).

---

## 8. 만들지 않는 것

각각 되돌릴 수 있는 판단이며, 이유가 남는 것이 핵심이다.

**`--plain`** — 사람용 렌더가 박스 문자를 쓰지 않고, TTY 가 아니면 ANSI 도 내지
않는다. `--json` 이 기계용을 덮으므로 세 번째 형식은 동기화 대상만 하나 더 늘리고
요구한 소비자가 없다.

**페이저** — 출력이 유계다. 브릿지가 payload 를 1 MB 로 자르고(`MAX_OUTGOING`),
규칙 목록은 수십 줄이다. 감사 가능성이 존재 이유인 도구가 자식 프로세스를 띄우는
비용에 맞는 이득이 없다.

**스피너·애니메이션** — §2.4 의 한 줄로 충분하다. 왕복이 로컬이라 정상 경로는
100ms 안에 든다.

**man 페이지** — `help <cmd>` 가 터미널 문서를 덮는다 (clig Documentation §2).
`ronn` 은 새 의존성이다.

**단일 바이너리** — clig Distribution §2 의 언어별 예외를 쓴다. 이 CLI 는 Node 로
쓰였고 Node 를 이미 가진 사람이 설치한다. 번들러는 새 의존성이며, 무엇이 들어갔는지
읽어서 확인할 수 있다는 이 프로젝트의 약속과 반대 방향이다.

**XDG 이전** — `bridge install` 이 `~/.headerlab/bin/` 에 런처를 쓴다. 경로를 옮기면
이미 설치된 런처를 가리키는 매니페스트가 조용히 끊긴다. 이번 릴리즈에서 하지 않고
별도 과제로 남긴다.

**`DEBUG` 지원** — `--json` 이 이미 모든 사실을 담고, §2.4 가 대기 상태를 말한다.
읽는 사람이 없는 세 번째 상세도를 만들지 않는다.

---

## 9. 파일 구조

```
packages/headerlab/
  bin/headerlab.mjs      변경 — 얇아진다. 파싱→실행→출력의 배선만
  lib/commands.mjs       신규 · 순수 — 명령표 (도움말·파서·제안의 단일 출처)
  lib/help.mjs           신규 · 순수 — 표 → 도움말 문자열
  lib/suggest.mjs        신규 · 순수 — Levenshtein 제안
  lib/render.mjs         신규 · 순수 — payload + {color} → 사람용 문자열
  lib/exit.mjs           신규 · 순수 — error.code → 종료 코드
  lib/output.mjs         신규 · 어댑터 — 유일하게 TTY·env·스트림을 아는 곳
  lib/args.mjs           변경 — commands.mjs 를 읽고, 전역 플래그를 먼저 걷는다
  lib/bridge.mjs         변경 — 1초 진행 표시 훅
  lib/install.mjs        변경 — dryRun 지원
  lib/socket.mjs         무변경
  lib/framing.mjs        무변경
  lib/host.mjs           무변경

lib/bridge/protocol.ts   변경 — querySchema 추가 (commandSchema 는 무변경)
lib/bridge/query.ts      신규 · 순수 — state → StatusPayload
lib/bridge/port.ts       변경 — query 분기
lib/bridge/apply.ts      무변경
```

**렌더는 순수하고 출력은 어댑터다.** `render.mjs` 는 색 여부를 인자로 받고 문자열을
돌려줄 뿐 `process` 를 모른다. `output.mjs` 만이 `process.stdout.isTTY`,
`process.env`, 스트림 쓰기, 종료 코드를 안다. 이 저장소가 확장 쪽에서 지키는 규율
— 판단은 순수 계층, 브라우저 호출은 얇은 어댑터 하나 — 을 CLI 에 적용한 것이며,
그 결과 사람용 출력이 프로세스를 띄우지 않고 테스트된다.

파일이 여섯 개 느는 것은 `bin/headerlab.mjs` 를 192줄에서 더 키우지 않기 위한
대가다. CLAUDE.md 의 200–400줄 지침과, "표현 로직이 I/O 가 허용된 유일한 파일에
얹히면 프로세스 없이는 못 테스트한다" 는 사실 둘 다에 근거한다.

---

## 10. 테스트

기존 아홉 개 `node:test` 파일은 남고, CLI 쪽에 여섯이 붙는다.

| 파일 | 무엇을 |
|---|---|
| `test/commands.test.mjs` | 표의 모든 항목이 실제 파서에 대응하고, 파서가 아는 모든 명령이 표에 있다 — **양방향** |
| `test/help.test.mjs` | 최상위·명령별 도움말이 표에서 파생되고, 예제가 실제로 파싱된다 |
| `test/suggest.test.mjs` | `sight`→`site`, 거리 3 은 제안 없음, 짧은 이름의 40% 규칙 |
| `test/render.test.mjs` | payload → 문자열. 색 on/off 양쪽 |
| `test/exit.test.mjs` | 모든 error.code 가 정확히 하나의 종료 코드로 간다. **매핑에 없는 코드가 있으면 실패** |
| `test/output.test.mjs` | TTY·`--json`·`NO_COLOR`·`TERM=dumb`·`--no-color`·`FORCE_COLOR` 조합의 모드 결정 |
| `test/process.test.mjs` | 프로세스를 실제로 띄워야만 보이는 셋 — 닫힌 파이프가 exit 0 이고 stderr 0바이트, SIGINT 가 한 줄과 130, `state set -` 이 pty 에서 멈추지 않음 |
| `tests/unit/query.test.ts` | `status(state)` 가 팝업과 같은 사실을 준다 |
| `tests/unit/purity.test.ts` | 손목록에 `lib/bridge/query.ts` 추가 (§4.2) |

세 가지를 특히 지킨다.

**`test/exit.test.mjs` 는 전수여야 한다.** 소스에서 error.code 문자열을 뽑아
매핑 표와 대조하고, 어느 한쪽에만 있으면 실패한다. 코드를 추가하고 종료 코드를 안
정하는 것이 이 설계에서 가장 쉬운 퇴행이다.

**`test/commands.test.mjs` 의 양방향성이 표의 존재 이유다.** 단방향이면 표에 없는
명령이 조용히 생기고, §5 의 약속(파서와 도움말은 어긋날 수 없다)이 거짓이 된다.

**"이 assertion 을 통과시키는 잘못된 구현은 무엇인가" 를 매 assertion 마다 묻는다.**
`toContain` 대신 정확한 값을, 부재를 존재보다 먼저. 이 저장소가 한 단계에서 결함
아홉을 낸 방식이 전부 이것이었다.

e2e 는 하나 는다: 실제 브릿지를 통과하는 읽기 명령. `tests/e2e/bridge.spec.ts` 가
`headerlab site add` 를 실제 소켓으로 밀어 `chrome.storage` 에서 결과를 읽는 것과
같은 강도로, `headerlab rule ls` 가 그 결과를 되읽는다.

**변이 검증을 커밋 후에 한다.** 커밋 전 변이 검증은 이 저장소에서
`git checkout --` 되돌리기로 실제 편집을 날린 적이 있다.

---

## 11. 호환성과 릴리즈

**0.2.0, breaking.** `0.1.2` 는 하루 된 단일 버전이고 실사용자는 사실상 저자뿐이다.

바뀌는 것과 안 바뀌는 것을 분명히 한다.

| | |
|---|---|
| **바뀜** | 기본 출력 모드(TTY 일 때), 실패 시 스트림(사람용), 종료 코드 0/1 → 0/1/2/3/4, `state set` 이 `--force` 를 요구, `invalid-command` 중 CLI 생산분이 `invalid-args` 로 개명 |
| **안 바뀜** | JSON payload 의 **구조** — 봉투(`{ok, error?, state?, changed?, note?}`), 필드 이름, 성공 응답의 전체 상태. 파이프나 `--json` 으로 호출하는 소비자가 stdout 에서 받는 바이트는 위 개명 한 건과 종료 코드를 빼면 동일 |

폐기 경고는 넣을 자리가 없다 — exit 1 만 읽던 스크립트는 이제 3 을 받을 뿐 경고를
띄울 후크가 없다. 대신 CHANGELOG 와 README 가 표를 그대로 싣는다.

함께 고치는 문서: `packages/headerlab/README.md`(uninstall 절 신설 —
clig Distribution §3 위반 확정), 루트 `README.md` 와 `docs/README.{ko,ja,zh,es}.md`
의 Agent bridge 절, `packages/plugin/skills/headerlab/SKILL.md`(`--json`·`--force`
명시와 종료 코드 표).

---

## 12. AS-IS / TO-BE

PR 본문에 그대로 들어간다.

| # | 항목 | AS-IS (측정) | TO-BE |
|---|---|---|---|
| 1 | `--help` / `-h` | `unknown-command`, exit 1 | 전체 도움말, stdout, exit 0 |
| 2 | `headerlab` (맨손) | 한 줄 usage JSON, exit 1 | 간결 도움말, stdout, exit 0 |
| 3 | `help <cmd>` · `<cmd> --help` | `unknown-command`, exit 1 | 명령별 도움말, exit 0 |
| 4 | `--version` | `unknown-command`, exit 1 | 버전, exit 0 |
| 5 | 오타 | `unknown command: sight` | `did you mean "site"?` |
| 6 | 사람용 출력 | 없음 — 항상 JSON | TTY 면 사람용, 파이프/`--json` 이면 JSON |
| 7 | 실패 시 stderr | 항상 0바이트 | 사람용 실패는 stderr, stdout 은 빈다 |
| 8 | 종료 코드 | 실패 전부 1 | 2 입력 · 3 브릿지 없음 · 4 전송 실패 · 1 거부 |
| 9 | 읽기 명령 | 없음 — 쓰기 응답으로만 상태를 본다 | `status` · `rule ls` · `site ls` · `state get` |
| 10 | `site add x --json` | exit 0, `--json` 이 도메인으로 저장됨 | 거부, exit 2 |
| 11 | `rule add --value` | 비밀값이 `ps` 에 노출 | `--value-file <path\|->` 추가, 도움말이 노출을 명시 |
| 12 | `state set` | 확인 없이 즉시 전체 덮어쓰기 | TTY 면 확인, 비대화형이면 `--force` 요구 |
| 13 | `state set -` on TTY | 무한 정지, 출력 0바이트 | 즉시 usage 에러, exit 2 |
| 14 | `bridge install` | dry-run 없음 | `--dry-run` 이 id·경로·매니페스트를 출력하고 쓰지 않음 |
| 15 | Ctrl-C | exit 130, 출력 0바이트 | stderr 한 줄, 소켓 정리, exit 130 |
| 16 | 무응답 브릿지 | 10초 침묵 후 `timeout` | 1초 뒤 stderr 진행 표시 |
| 17 | 색 | 없음 | 정보만 색. `NO_COLOR`·`TERM=dumb`·`--no-color`·`HEADERLAB_NO_COLOR`·비TTY 에서 끔 |
| 18 | `-q` · `--quiet` | 없음 | 성공 렌더 억제 |
| 19 | 제보 경로 | CLI·README·package.json 어디에도 URL 이 없음 | 도움말 하단 + `package.json` 의 `bugs` |
| 20 | uninstall 안내 | README 에 절이 없음 | README 에 uninstall 절 |
| 21 | `… \| true` (닫힌 파이프) | Node 스택 트레이스 1106바이트, 25줄 | 조용히 exit 0 |
| 22 | 예상 못 한 예외 | 원시 스택 트레이스, 버그라는 말 없음 | 세 줄 + 내용이 채워진 이슈 URL |
| 23 | 쓰기 응답 | AppState 전체를 되돌려줌 | 사람용은 요약. 기계용 봉투는 그대로 |
| 24 | `bridge-off` 메시지 | `no bridge is running` 이 전부 | 다음에 칠 명령 둘과 사람만 할 수 있는 단계 |
