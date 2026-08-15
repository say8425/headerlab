/**
 * 이 CLI 의 명령표. 순수 데이터이며, 네 가지가 전부 여기서 파생된다:
 * `--help`/`-h` 의 최상위 도움말, `help <cmd>` 의 명령별 도움말,
 * `lib/args.mjs` 가 내는 에러 메시지의 usage 줄, 오타 제안의 후보 집합.
 *
 * 도움말을 손으로 따로 쓰면 파서와 어긋나고, 어긋난 것을 아무것도 잡지
 * 않는다 — 이 저장소가 한 술어를 네 번 구현하고 갈라뜨려 치른 비용과
 * 같은 모양이다. `test/commands.test.mjs` 가 표와 파서를 양방향으로 묶는다.
 */

export const COMMANDS = [
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
        arg: '<path>',
        summary: 'read the value from a file — use this for secrets',
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
