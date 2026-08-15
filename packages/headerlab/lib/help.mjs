import { COMMANDS, pathKey } from './commands.mjs';

/**
 * 표(`commands.mjs`)를 사람이 읽을 문자열로 옮긴다. 이 파일은 표를 읽기만
 * 하고 명령을 알지 못한다 — 명령이 하나 늘면 표에 한 줄이 늘 뿐 여기는
 * 그대로다.
 */

export const ISSUES_URL = 'https://github.com/say8425/headerlab/issues';

export function usageLine(entry) {
  const parts = ['headerlab', ...entry.path];
  if (entry.args) parts.push(entry.args);
  return parts.join(' ');
}

const pad = (text, width) => text.padEnd(width, ' ');

export function topHelp() {
  const examples = [
    ['headerlab status', 'what is set up right now'],
    ['headerlab site add example.com', 'scope the rules to a site'],
    ['headerlab rule add --target request --name X-Debug --value 1', ''],
    ['headerlab state get --json | jq .state', 'read the whole state'],
  ];

  // 그룹 단위로 접어서 보여준다. 열두 줄을 낱낱이 세우면 최상위 도움말이
  // 스크롤되고, clig Help §8 이 말하는 "흔한 것을 앞에" 가 무너진다.
  const groups = [
    ['status', '', 'what is installed, live, and configured'],
    ['site', 'add rm ls all-sites', 'which sites the rules apply to'],
    ['rule', 'add rm ls toggle', 'the header rules themselves'],
    ['pause | resume', '', 'stop and restart header modification'],
    ['state', 'get set', 'read or replace the whole stored state'],
    ['bridge', 'install uninstall status', 'the native-messaging host manifest'],
  ];

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
    ...examples.map(([cmd, note]) => (note ? `  ${pad(cmd, 42)}${note}` : `  ${cmd}`)),
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
