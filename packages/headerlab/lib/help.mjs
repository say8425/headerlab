import { COMMANDS, GROUPS, pathKey } from './commands.mjs';

/**
 * 표(`commands.mjs`)를 사람이 읽을 문자열로 옮긴다. 이 파일은 표를 읽기만
 * 하고 명령을 알지 못한다 — 명령이 하나 늘면 표에 한 줄이 늘 뿐 여기는
 * 그대로다.
 */

export const ISSUES_URL = 'https://github.com/say8425/headerlab/issues';

/**
 * 최상위 도움말의 예제. `entry.examples` (COMMANDS 안의 예제)와 달리 이
 * 배열은 명령 하나짜리가 아니라 손으로 고른 대표 넷이라 표에서 파생할
 * 수 없다 — 그래서 `test/commands.test.mjs`가 이 배열 자체를 파서에
 * 먹여서 전부 파싱되는지를 따로 검사한다. COMMANDS 안의 예제만 검사하던
 * 이전 가드는 이 배열을 보지 못했고, 그 틈으로 존재하지 않는 `status`와
 * `state get`이 여기 살아 있었다.
 */
export const EXAMPLES = [
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
 * 손으로 지어낸 사례다 — 셋 다 `commands.mjs`에 없고 파서도 모른다.
 */
const GROUP_NOTES = {
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

export function topHelp() {
  // 그룹 단위로 접어서 보여준다. 열두 줄을 낱낱이 세우면 최상위 도움말이
  // 스크롤되고, clig Help §8 이 말하는 "흔한 것을 앞에" 가 무너진다.
  const groups = GROUPS.map((group) => {
    const subs = COMMANDS.filter((c) => c.path[0] === group && c.path.length > 1)
      .map((c) => c.path[1])
      .join(' ');
    return [group, subs, GROUP_NOTES[group] ?? ''];
  });

  const flags = [
    ['    --json', 'machine-readable output (the default when not a terminal)'],
    ['-q, --quiet', 'errors only'],
    ['    --no-color', 'disable colour (also honours NO_COLOR, TERM=dumb)'],
    ['-h, --help', "this help, or a command's help"],
    ['    --version', 'print the version'],
    ['    --bridge <pid>', 'pick a bridge when more than one is running'],
  ];

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
    ...flags.map(([name, note]) => `  ${pad(name, 18)}${note}`),
    '',
    'The CLI cannot turn the bridge on — a person must press Enable in the popup.',
    'Run `headerlab help bridge install` for why.',
    '',
    `Report a problem: ${ISSUES_URL}`,
  ].join('\n');
}

export function commandHelp(entry) {
  const lines = [`headerlab ${pathKey(entry.path)} — ${entry.summary}`, '', 'USAGE', `  ${usageLine(entry)}`];

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

  lines.push('', `Report a problem: ${ISSUES_URL}`);
  return lines.join('\n');
}

/** `help` 로도 `--help` 로도 안 잡히는 이름에 붙일 후보 목록. */
export function allPaths() {
  return COMMANDS.map((c) => pathKey(c.path));
}
