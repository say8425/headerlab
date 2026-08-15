import { renderError, renderResult, usageFor } from './render.mjs';

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
  if (globals.human) return 'human';
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

/**
 * 아래 둘은 **쓰지 않고 계획만 낸다** — `{stream, text}` 또는 아무것도 쓰지
 * 않는다는 뜻의 `null`. 이 판단(어느 스트림인가, 봉투인가 산문인가,
 * `--quiet` 에 지워지는가)은 `bin/headerlab.mjs` 의 `emitOk`/`emitFail` 안에
 * 있었고, 사람용 분기에는 어떤 테스트도 닿지 못했다: 그 분기는 stdout 이
 * TTY 여야 켜지는데 `node --test` 가 띄우는 자식의 stdout 은 파이프이고,
 * Node 는 의존성 없이 pty 를 열 수 없다.
 *
 * 이 파일의 위 docblock 이 이미 "그 문자열이 어디로 어떤 모습으로 갈지는
 * 여기가 정한다" 라고 적고 있었으니, 결정이 bin/ 에 남아 있던 것이 어긋난
 * 쪽이었다. 이제 bin/ 에 남은 것은 `process[plan.stream].write(plan.text)`
 * 한 줄이다.
 *
 * 계획은 줄바꿈까지 포함해 쓸 바이트를 통째로 서술한다. bin/ 이 줄바꿈을
 * 붙이는 두 번째 규칙을 갖게 되면 그 규칙이 다시 테스트 밖으로 나간다.
 */
export function planOk(payload, { mode, quiet, command, color }) {
  if (mode === 'json') return { stream: 'stdout', text: `${JSON.stringify(payload)}\n` };
  // 봉투는 API 이므로 위쪽에서 걸리지 않는다. `--quiet`("errors only") 는
  // 사람이 읽는 산문에 대한 요구이지 기계용 계약에 대한 요구가 아니다.
  if (quiet) return null;
  const text = renderResult(payload, { command, color });
  return text.length === 0 ? null : { stream: 'stdout', text: `${text}\n` };
}

/**
 * 실패는 `--quiet` 에 지워지지 않는다 — "errors only" 는 에러를 남기라는
 * 뜻이지 없애라는 뜻이 아니다. 그래서 이 함수는 `quiet` 을 읽지 않는다.
 */
export function planFail({ code, message }, { mode, color, argv = null }) {
  if (mode === 'json') {
    // 기계용 모드에서 에러 객체는 진단이 아니라 주 출력이다 — `jq` 가
    // stdout 에서 받아야 기존 계약이 바이트 그대로 유지된다. 스트림
    // 선택을 형식 계약의 일부로 본다 (설계 §2.2, clig 로부터의 의도적 이탈).
    // usage 줄은 여기 붙지 않는다: 봉투의 `error.message` 는 첫 문장 그대로다.
    return {
      stream: 'stdout',
      text: `${JSON.stringify({ ok: false, error: { code, message } })}\n`,
    };
  }
  const lines = [renderError({ code, message }, { color })];
  const usage = usageFor(code, argv);
  if (usage !== null) lines.push(usage);
  return { stream: 'stderr', text: `${lines.join('\n')}\n` };
}
