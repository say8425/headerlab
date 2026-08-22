/**
 * 이 CLI 의 명령표. 순수 데이터이며, 네 가지가 전부 여기서 파생된다:
 * `--help`/`-h` 의 최상위 도움말, `help <cmd>` 의 명령별 도움말,
 * `lib/args.mjs` 가 내는 에러 메시지의 usage 줄, 오타 제안의 후보 집합.
 *
 * 도움말을 손으로 따로 쓰면 파서와 어긋나고, 어긋난 것을 아무것도 잡지
 * 않는다 — 이 저장소가 한 술어를 네 번 구현하고 갈라뜨려 치른 비용과
 * 같은 모양이다. `test/commands.test.mjs` 가 표와 파서를 양방향으로 묶는다.
 */

/**
 * 전역 플래그의 표. 명령표와 같은 이유로 여기 있다: 이 목록은
 * `lib/bridge.mjs` 의 `extractGlobals` 가 파싱하는 것이자 `lib/help.mjs` 의
 * 최상위 FLAGS 블록이 찍는 것이고, 두 곳에 손으로 적혀 있는 동안 실제로
 * 갈라졌다 — `--no-input` 은 파서가 알고 도움말이 모르는 플래그였고,
 * `-f`/`--force` 도 최상위 목록에서 빠져 있었다. 스킬(SKILL.md)이
 * 에이전트에게 쓰라고 알려주는 플래그를 사람이 `--help` 로는 찾을 수 없는
 * 상태였다는 뜻이다.
 *
 * `arg` 가 있는 항목은 값을 하나 먹는다(`--bridge <pid>`). 나머지는 전부
 * 불리언이며 `extractGlobals` 가 이 표에서 자기 맵을 만든다 — 여기 한 줄을
 * 더하는 것이 파서와 도움말 양쪽을 동시에 늘리는 유일한 방법이다.
 * `test/commands.test.mjs` 가 두 방향을 묶는다.
 */
export const GLOBAL_FLAGS = [
  {
    names: ['--json'],
    key: 'json',
    summary: 'machine-readable output (the default when not a terminal)',
  },
  {
    names: ['--human'],
    key: 'human',
    summary: 'human-readable output (the default on a terminal)',
  },
  { names: ['-q', '--quiet'], key: 'quiet', summary: 'errors only' },
  {
    names: ['--no-color'],
    key: 'noColor',
    summary: 'disable colour (also honours NO_COLOR, TERM=dumb)',
  },
  {
    names: ['--no-input'],
    key: 'noInput',
    summary: 'never prompt — fail and name the flag to pass instead',
  },
  {
    names: ['-f', '--force'],
    key: 'force',
    summary: 'confirm a destructive command without asking',
  },
  { names: ['-h', '--help'], key: 'help', summary: "this help, or a command's help" },
  { names: ['--version'], key: 'version', summary: 'print the version' },
  {
    names: ['--bridge'],
    key: 'bridgePid',
    arg: '<pid>',
    summary: 'pick a bridge when more than one is running',
  },
];

export const COMMANDS = [
  // 읽기 넷이 먼저다 (clig Help §8, "흔한 것을 앞에"). 파서에게는 넷이
  // 한 명령(`{cmd:'status'}`)이지만 표에게는 넷이다 — 사람이 치는 이름이
  // 넷이고, 도움말·usage 줄·오타 제안이 전부 이 표에서 나온다.
  {
    path: ['status'],
    summary: 'what is installed, live, and configured',
    examples: ['headerlab status'],
    // 설계 §3.1 은 `status` 의 **도움말**과 사람용 출력 끝줄이 둘 다 이
    // 구분을 한 줄로 적기를 요구한다 (clig Subcommands §4 의 모호함 위험).
    // 사람용 끝줄은 `render.mjs` 가 이미 붙이고 있었고, 도움말 쪽이 비어
    // 있었다 — 두 이름을 나란히 놓고 구분하지 못하는 사람이 손을 뻗는
    // 곳이 바로 도움말이다.
    notes: '`headerlab bridge status` reports one install location; this reports everything.',
  },
  {
    path: ['site', 'ls'],
    summary: 'list the sites the rules are scoped to',
    examples: ['headerlab site ls'],
  },
  {
    path: ['rule', 'ls'],
    summary: 'list the header rules',
    examples: ['headerlab rule ls'],
  },
  {
    path: ['state', 'get'],
    summary: 'print the entire stored state',
    examples: ['headerlab state get', 'headerlab state get --json | jq .state'],
  },
  {
    path: ['site', 'add'],
    args: '<domain>...',
    summary: 'scope the rules to one or more sites',
    examples: ['headerlab site add example.com', 'headerlab site add a.example.com b.example.com'],
  },
  {
    path: ['site', 'rm'],
    args: '<domain>...',
    summary: 'remove sites from the scope',
    examples: ['headerlab site rm example.com'],
  },
  {
    path: ['site', 'all-sites'],
    args: 'on|off',
    summary: 'turn the applies-everywhere mode on or off',
    examples: ['headerlab site all-sites on'],
  },
  {
    path: ['rule', 'add'],
    summary: 'add one header rule',
    flags: [
      { name: '--target', arg: 'request|response', summary: 'which direction to modify' },
      { name: '--op', arg: 'set|append|remove', summary: 'what to do with the header' },
      { name: '--name', arg: '<header>', summary: 'the header name (default: empty)' },
      {
        name: '--value',
        arg: '<value>',
        summary: 'the header value — lands in ps output and shell history',
      },
      {
        name: '--value-file',
        arg: '<path|->',
        summary: 'read the value from a file, or from stdin with - — use this for secrets',
      },
    ],
    examples: ['headerlab rule add --target request --op set --name X-Debug --value 1'],
  },
  {
    path: ['rule', 'rm'],
    args: '<id>',
    summary: 'remove a rule by id',
    examples: ['headerlab rule rm 3f9a'],
  },
  {
    path: ['rule', 'toggle'],
    args: '<id>',
    summary: 'turn a rule on or off, or flip it',
    flags: [
      { name: '--on', summary: 'turn it on' },
      { name: '--off', summary: 'turn it off' },
    ],
    examples: ['headerlab rule toggle 3f9a', 'headerlab rule toggle 3f9a --off'],
  },
  {
    path: ['pause'],
    summary: 'stop modifying headers, without changing any rule',
    examples: ['headerlab pause'],
  },
  { path: ['resume'], summary: 'resume after a pause', examples: ['headerlab resume'] },
  {
    path: ['state', 'set'],
    args: '<file|->',
    summary: 'replace the entire stored state',
    flags: [
      { name: '--force', summary: 'confirm the overwrite (required when not on a terminal)' },
    ],
    examples: [
      'headerlab state set state.json --force',
      'headerlab state get --json | jq .state | headerlab state set - --force',
    ],
  },
  {
    path: ['bridge', 'install'],
    summary: 'install the native-messaging host manifest',
    flags: [
      { name: '--extension-id', arg: '<id>', summary: 'the id from chrome://extensions' },
      { name: '--load-path', arg: '<dir>', summary: 'compute the id from an unpacked directory' },
      { name: '--user-data-dir', arg: '<dir>', summary: 'a non-default Chrome profile directory' },
      { name: '--browser', arg: 'chrome|chromium', summary: 'which browser (default: chrome)' },
      { name: '-n, --dry-run', summary: 'show what would be written and write nothing' },
    ],
    examples: ['headerlab bridge install --extension-id abcdefghijklmnopabcdefghijklmnop'],
    // 최상위 도움말의 마지막 줄이 이 자리를 "왜 CLI 가 브릿지를 켤 수
    // 없는지" 의 설명으로 가리킨다. 가리키는 곳에 설명이 없으면 그 줄은
    // 검사할 수 없는 주장이고, 이 저장소는 그것을 결함으로 친다.
    notes:
      'Writing the manifest is not turning the bridge on. A person must open the HeaderLab\n' +
      'popup and turn on the switch on its Agent bridge row — the CLI can write this file,\n' +
      'but it cannot grant the nativeMessaging permission or flip that switch.',
  },
  {
    path: ['bridge', 'uninstall'],
    summary: 'remove the manifest this installed',
    flags: [
      { name: '--user-data-dir', arg: '<dir>', summary: 'a non-default Chrome profile directory' },
      { name: '--browser', arg: 'chrome|chromium', summary: 'which browser (default: chrome)' },
    ],
    examples: ['headerlab bridge uninstall'],
  },
  {
    path: ['bridge', 'status'],
    summary: 'report what is installed at one location',
    flags: [
      { name: '--user-data-dir', arg: '<dir>', summary: 'a non-default Chrome profile directory' },
      { name: '--browser', arg: 'chrome|chromium', summary: 'which browser (default: chrome)' },
    ],
    examples: ['headerlab bridge status', 'headerlab bridge status --browser chromium'],
  },
];

export const GROUPS = [...new Set(COMMANDS.map((c) => c.path[0]))];

/** `['site','add']` → `'site add'`. 표를 문자열로 다루는 모든 곳이 이 한 줄을 쓴다. */
export const pathKey = (path) => path.join(' ');

export function commandPaths() {
  return COMMANDS.map((c) => pathKey(c.path));
}

/**
 * 한 그룹 소속 서브커맨드의 두 번째 토큰들. `site` 라면 `['ls','add','rm',
 * 'all-sites']`. `topHelp` 가 최상위 도움말에 그룹별 서브커맨드 줄을 접어
 * 보여줄 때 이미 하던 계산과 같은 것이며, `bin/headerlab.mjs` 의
 * `warnIfUnknown` 이 모르는 서브커맨드에 오타 제안 후보를 주려고 따로
 * 가져다 쓴다 — 서브커맨드가 표에 늘 때마다 두 곳을 손으로 맞출 필요가
 * 없도록 표에서 뽑는다.
 */
export function subcommandsOf(group) {
  return COMMANDS.filter((c) => c.path[0] === group && c.path.length > 1).map((c) => c.path[1]);
}

/**
 * argv 앞머리에서 가장 긴 일치를 고른다. `site all-sites on` 이
 * `site` 가 아니라 `site all-sites` 로 잡혀야 하므로 길이 내림차순이다.
 */
export function findCommand(argv) {
  const sorted = [...COMMANDS].sort((a, b) => b.path.length - a.path.length);
  for (const command of sorted) {
    if (command.path.every((token, i) => argv[i] === token)) return command;
  }
  return null;
}
