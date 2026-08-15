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

/**
 * 던져진 에러를 **봉투에 실을 코드**로 옮긴다. 던져진 실패를 봉투로 옮기는
 * 모든 자리에서 쓴다 — 소켓으로 나갔다가 실패한 자리(`send` 의 catch)만이
 * 아니라, 소켓에 한 바이트도 쓰지 않은 자리들(`resolveTarget` 의 catch,
 * `runStatus`·`runBridgeCommand` 의 로컬 조회)도 포함이다. 이 문장이 한동안
 * "소켓으로 나갔다가 실패한 자리에서만" 이라고 적혀 있었는데, 그 사이 아무
 * 것도 안 보낸 호출부가 둘 늘었다. 같은 실패에 명령마다 다른 코드가 나가지
 * 않는 것이 이 함수의 목적이고, 그것은 소켓에 닿았는지와 무관하다.
 *
 * 측정해서 알게 된 것: `error.code ?? 'bridge-error'` 는 코드가 **없는**
 * 에러만 걸러 낸다. 소켓이 내는 에러에는 코드가 있고, 그것이 errno 다 —
 * 연결하자마자 끊는 호스트에 명령을 쓰면 5/5 로 `EPIPE` 가 나온다. 그러면
 * 봉투의 `error.code` 가 `"EPIPE"` 로 나가는데, 그것은 이 파일의 표에
 * 없으므로 `exitFor` 의 기본값을 타고 1("목적지가 요청을 거부했다")이 된다.
 * 아무것도 목적지에 닿은 적이 없는데도.
 *
 * 그래서 표에 있는 코드만 통과시키고 나머지는 전부 `bridge-error`(4,
 * "연결은 됐으나 교환이 실패했다")로 접는다. errno 는 봉투의 계약이 아니다 —
 * `ERROR_CODES` 가 계약이고, 그 목록에 없는 문자열이 `error.code` 로 나가면
 * 그것을 읽는 쪽은 분기할 것이 없다. 원래 메시지는 그대로 실려 나가므로
 * 어느 errno 였는지는 사람이 여전히 읽을 수 있다.
 */
export function codeForThrown(error) {
  const code = error?.code;
  return typeof code === 'string' && BY_CODE.has(code) ? code : 'bridge-error';
}
