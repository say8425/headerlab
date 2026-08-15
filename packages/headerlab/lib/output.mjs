/**
 * 이 패키지에서 TTY 와 환경변수의 뜻을 아는 유일한 곳. `render.mjs` 는
 * 순수하게 문자열을 만들고, 그 문자열이 어디로 어떤 모습으로 갈지는
 * 여기가 정한다.
 *
 * 두 함수 다 `process` 를 전역으로 읽지 않고 인자로 받는다 — 조합이
 * 열 가지가 넘고, 그걸 프로세스를 띄워 가며 검사하는 것과 표로 검사하는
 * 것은 비용이 다르다.
 */

/**
 * 기계용인가 사람용인가. **stdout 만 본다** — 모드는 주 출력이 어디로
 * 가는지의 문제이고, stderr 가 파이프인지 여부는 그것과 무관하다.
 */
export function resolveMode(globals, streams) {
  if (globals.json) return 'json';
  return streams.stdout?.isTTY ? 'human' : 'json';
}

/**
 * 이 스트림에 색을 칠할 것인가. clig Output §13 의 목록 그대로이며,
 * 판정을 스트림마다 따로 하는 것이 중요하다: 사람용 실패는 stderr 로
 * 가므로, stdout 의 TTY 여부로만 정하면 `headerlab status > out.txt` 가
 * 화면에 남는 에러를 흑백으로 만들고 `2> err.txt` 는 파일에 이스케이프를
 * 적는다.
 *
 * `FORCE_COLOR` 가 마지막에 오는 것이 아니라 `NO_COLOR` 계열보다 약한
 * 것이 의도다 — 끄라는 요청이 켜라는 요청을 이긴다.
 */
export function resolveColor(globals, env, stream) {
  if (globals.noColor) return false;
  if (env.NO_COLOR !== undefined) return false;
  if (env.HEADERLAB_NO_COLOR !== undefined) return false;
  if (env.TERM === 'dumb') return false;
  if (env.FORCE_COLOR !== undefined) return true;
  return Boolean(stream?.isTTY);
}
