import { COMMANDS, GLOBAL_FLAGS, GROUPS, pathKey } from './commands.mjs';

/**
 * 표(`commands.mjs`)를 사람이 읽을 문자열로 옮긴다. 이 파일은 표를 읽기만
 * 하고 명령을 알지 못한다 — 명령이 하나 늘면 표에 한 줄이 늘 뿐 여기는
 * 그대로다.
 */

export const ISSUES_URL = 'https://github.com/say8425/headerlab/issues';

/**
 * 최상위 도움말의 마지막 문단이 "왜 CLI 가 브릿지를 켤 수 없는지" 의
 * 설명으로 가리키는 명령. 상수로 둔 이유는 그 줄이 **검사 가능한 주장**이기
 * 때문이다 — `test/help.test.mjs` 가 이 경로를 표에서 찾아 그 항목이 실제로
 * 설명(`notes`)을 담는지 본다. 예전에는 이 자리가 문자열 리터럴이었고,
 * 가리켜진 `bridge install` 도움말에는 usage·flags·예제뿐 그 이유가 한 줄도
 * 없었다.
 */
export const WHY_BRIDGE_PATH = 'bridge install';

/**
 * 최상위 도움말의 예제. `entry.examples` (COMMANDS 안의 예제)와 달리 이
 * 배열은 명령 하나짜리가 아니라 손으로 고른 대표들이라 표에서 파생할
 * 수 없다 — 그래서 `test/commands.test.mjs`가 이 배열 자체를 파서에
 * 먹여서 전부 파싱되는지를 따로 검사한다. COMMANDS 안의 예제만 검사하던
 * 이전 가드는 이 배열을 보지 못했고, 그 틈으로 존재하지 않는 `status`와
 * `state get`이 여기 살아 있었다. 지금 `headerlab status`가 다시 첫 줄에
 * 있는 것은 그때와 반대 방향이다 — 명령이 먼저 생겼고 파서와 표가 그것을
 * 알며, 그 사실을 지키는 것은 이 주석이 아니라 그 테스트다.
 */
export const EXAMPLES = [
  ['headerlab status', 'what is installed, live, and configured'],
  ['headerlab site add example.com', 'scope the rules to a site'],
  ['headerlab rule add --target request --op set --name X-Debug --value 1', ''],
  ['headerlab bridge status', 'what the native-messaging host has installed'],
  ['headerlab pause', 'stop modifying headers, without touching any rule'],
];

/**
 * 그룹별 한 줄 설명. `GROUP_NOTES`의 키는 사람이 고른 설명일 뿐이고, 어느
 * 그룹이 실제로 존재하는지와 그 아래 서브커맨드가 무엇인지는 아래
 * `topHelp`가 `COMMANDS`/`GROUPS`에서 매번 다시 뽑는다 — 없는 그룹이나
 * 없는 서브커맨드를 여기서 새로 지어낼 길이 없다. `status`가 최상위
 * 그룹으로, `ls`가 `site`/`rule`의 서브커맨드로, `get`이 `state`의
 * 서브커맨드로 예전에 하드코딩되어 있던 것이 바로 이 표에 없는 이름을
 * 손으로 지어낸 사례다. 넷은 그 뒤 **실제로** 만들어져 `commands.mjs`에
 * 들어갔고 파서도 안다 — 그래서 지금 여기 있는 것은 지어낸 이름이 아니라
 * 표에서 온 이름이며, 이 문단이 남아 있는 이유는 그 순서가 반대였던 적이
 * 있기 때문이다.
 */
const GROUP_NOTES = {
  status: 'what is installed, live, and configured',
  site: 'which sites the rules apply to',
  rule: 'the header rules themselves',
  pause: 'stop modifying headers, without changing any rule',
  resume: 'resume after a pause',
  state: 'read or replace the whole stored state',
  bridge: 'the native-messaging host manifest',
};

export function usageLine(entry) {
  const parts = ['headerlab', ...entry.path];
  if (entry.args) parts.push(entry.args);
  return parts.join(' ');
}

const pad = (text, width) => text.padEnd(width, ' ');

/**
 * `['-q','--quiet']` → `'-q, --quiet'`, `['--json']` → `'    --json'`. 짧은
 * 이름이 없는 줄도 긴 이름의 첫 글자가 같은 열에서 시작하도록 네 칸을
 * 채운다.
 */
function globalFlagLabel(flag) {
  const names = flag.names.length > 1 ? flag.names.join(', ') : `    ${flag.names[0]}`;
  return flag.arg ? `${names} ${flag.arg}` : names;
}

export function topHelp() {
  // 그룹 단위로 접어서 보여준다. 열두 줄을 낱낱이 세우면 최상위 도움말이
  // 스크롤되고, clig Help §8 이 말하는 "흔한 것을 앞에" 가 무너진다.
  const groups = GROUPS.map((group) => {
    const subs = COMMANDS.filter((c) => c.path[0] === group && c.path.length > 1)
      .map((c) => c.path[1])
      .join(' ');
    return [group, subs, GROUP_NOTES[group] ?? ''];
  });

  // 표에서 뽑는다 — 손으로 적힌 사본이던 동안 `--no-input` 과 `--force` 가
  // 파서에만 있고 여기 없었다. 폭도 가장 긴 이름에서 다시 잰다: 18 이라는
  // 리터럴이 `    --bridge <pid>` (정확히 18자) 와 설명을 붙여 놓았고,
  // 이것은 `render.mjs` 의 `would install` 이 이미 한 번 겪은 함정이다.
  const flags = GLOBAL_FLAGS.map((flag) => [globalFlagLabel(flag), flag.summary]);
  const flagWidth = Math.max(...flags.map(([name]) => name.length)) + 2;

  return [
    "headerlab — drive the HeaderLab Chrome extension's header rules from a terminal",
    '',
    'USAGE',
    '  headerlab <command> [flags]',
    '',
    'EXAMPLES',
    ...EXAMPLES.map(([cmd, note]) => (note ? `  ${pad(cmd, 42)}${note}` : `  ${cmd}`)),
    '',
    'COMMANDS',
    ...groups.map(([name, subs, note]) => `  ${pad(name, 9)}${pad(subs, 26)}${note}`),
    '',
    'FLAGS',
    ...flags.map(([name, note]) => `  ${pad(name, flagWidth)}${note}`),
    '',
    'The CLI cannot turn the bridge on — a person must switch it on in the popup.',
    `Run \`headerlab help ${WHY_BRIDGE_PATH}\` for why.`,
    '',
    `Report a problem: ${ISSUES_URL}`,
  ].join('\n');
}

export function commandHelp(entry) {
  const lines = [
    `headerlab ${pathKey(entry.path)} — ${entry.summary}`,
    '',
    'USAGE',
    `  ${usageLine(entry)}`,
  ];

  if (entry.flags?.length) {
    lines.push('', 'FLAGS');
    const width = Math.max(...entry.flags.map((f) => `${f.name} ${f.arg ?? ''}`.trim().length));
    for (const flag of entry.flags) {
      lines.push(`  ${pad(`${flag.name} ${flag.arg ?? ''}`.trim(), width + 2)}${flag.summary}`);
    }
  }

  if (entry.examples?.length) {
    lines.push('', 'EXAMPLES', ...entry.examples.map((e) => `  ${e}`));
  }

  // 표의 `notes` 는 usage 도 플래그도 예제도 아닌 것 — 이 명령이 무엇이
  // *아닌지*, 또는 옆의 비슷한 이름과 무엇이 다른지. 예제 뒤, 제보 줄 앞이다.
  if (entry.notes) lines.push('', entry.notes);

  lines.push('', `Report a problem: ${ISSUES_URL}`);
  return lines.join('\n');
}

/**
 * `headerlab help bridge` — 그룹 이름 하나. 표에 그룹 단독 항목이 없어서
 * 예전에는 최상위 도움말로 조용히 떨어졌다: 방금 읽던 화면이 다시 나오고,
 * 그 그룹에 서브커맨드가 있다는 것도 그것이 무엇인지도 말하지 않았다.
 * 설계 §5 는 `help <cmd>` 가 그 명령의 도움말을 준다고 약속한다.
 */
export function groupHelp(group) {
  const entries = COMMANDS.filter((c) => c.path[0] === group && c.path.length > 1);
  const width = Math.max(...entries.map((c) => c.path[1].length)) + 2;
  return [
    `headerlab ${group} — ${GROUP_NOTES[group] ?? ''}`.trimEnd(),
    '',
    'USAGE',
    `  headerlab ${group} <command> [flags]`,
    '',
    'COMMANDS',
    ...entries.map((c) => `  ${pad(c.path[1], width)}${c.summary}`),
    '',
    `Run \`headerlab help ${group} <command>\` for one of them.`,
    '',
    `Report a problem: ${ISSUES_URL}`,
  ].join('\n');
}
