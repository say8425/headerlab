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
