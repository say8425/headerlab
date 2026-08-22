/**
 * payload 를 사람이 읽을 문자열로 옮긴다. **순수** — `process` 를 읽지
 * 않고, 색 여부는 인자로 받는다. 스트림·TTY·환경변수를 아는 것은
 * `lib/output.mjs` 하나뿐이며, 그 분리 덕분에 사람용 출력이 프로세스를
 * 띄우지 않고 테스트된다.
 *
 * 요약하되 전체를 찍지 않는다 (clig Output §5). 쓰기 응답은 AppState 를
 * 통째로 실어 오지만 — 기계용 봉투는 그 계약을 지킨다 — 사람에게 그것을
 * 보여줄 이유는 없었던 적이 없다.
 */

import { findCommand } from './commands.mjs';
import { usageLine } from './help.mjs';

export const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  amber: '\x1b[33m',
};

const paint = (text, color, on) => (on ? `${color}${text}${COLORS.reset}` : text);
const pad = (text, width) => text.padEnd(width, ' ');

function activeProfile(state) {
  return state?.profiles?.[0] ?? null;
}

function scopeSummary(state) {
  const profile = activeProfile(state);
  if (profile === null) return 'nothing in scope';
  if (profile.filter.allSites) return 'applying to all sites';
  const domains = profile.filter.domains;
  if (domains.length === 0) return 'nothing in scope';
  const noun = domains.length === 1 ? 'site' : 'sites';
  return `${domains.length} ${noun} in scope: ${domains.join(', ')}`;
}

/**
 * 쓰기 응답의 한 줄 요약. 갈래는 넷이고, `state` 가 넷째다 — 없던 동안
 * `state set` 은 else 로 떨어져 `pauseSummary` 를 탔고, 되돌릴 수 없는 전체
 * 덮어쓰기를 확인까지 하고 실행한 사람이 보는 것은 `running` 한 단어였다.
 * 아무 일도 안 일어났을 때와 바이트가 같은 문장이다.
 */
function renderWrite(payload, command) {
  const summary =
    command[0] === 'site'
      ? scopeSummary(payload.state)
      : command[0] === 'rule'
        ? ruleSummary(payload.state)
        : command[0] === 'state'
          ? stateSummary(payload.state)
          : pauseSummary(payload.state);
  if (payload.changed === false) return `nothing changed — ${summary}`;
  return summary;
}

function stateSummary(state) {
  return `replaced — ${ruleSummary(state)}, ${scopeSummary(state)}`;
}

function ruleSummary(state) {
  const profile = activeProfile(state);
  const rules = profile?.headers ?? [];
  const on = rules.filter((rule) => rule.enabled).length;
  const noun = rules.length === 1 ? 'rule' : 'rules';
  return `${rules.length} ${noun}, ${on} on`;
}

function pauseSummary(state) {
  return state?.globalPause ? 'paused — no headers are being modified' : 'running';
}

function renderBridgeStatus(payload, color) {
  const manifest = payload.installed ? 'installed' : 'not installed';
  const launcherText = payload.launcherMissing
    ? 'missing'
    : payload.entryMissing
      ? 'entry missing'
      : 'ok';
  const launcherColor = payload.launcherMissing
    ? COLORS.red
    : payload.entryMissing
      ? COLORS.amber
      : COLORS.green;
  // 너비는 칠하기 **전** 텍스트로 잰다 — `paint()` 가 두른 ESC 바이트가
  // 폭에 끼어들면 색이 켜졌을 때 패딩이 하나도 안 붙는다(측정: 위 테스트).
  // 색은 이미 패딩까지 채운 문자열 전체를 두른다.
  const launcher = paint(pad(launcherText, 15), launcherColor, color);
  const live =
    payload.liveBridges.length === 0
      ? 'not running'
      : `${payload.liveBridges.length} live (${payload.liveBridges.map((b) => `pid ${b.pid}`).join(', ')})`;

  return [
    `manifest  ${pad(manifest, 15)}${paint(payload.manifestPath, COLORS.dim, color)}`,
    `launcher  ${launcher}${paint(payload.launcherPath, COLORS.dim, color)}`,
    `bridge    ${live}`,
  ]
    .map((line) => line.trimEnd())
    .join('\n');
}

function renderBridgeInstall(payload, color) {
  const verb = payload.dryRun ? 'would install' : 'installed';
  // 폭 11 은 브리프 그대로였으나, 'would install' 이 13 글자라 pad() 가
  // 아무 것도 못 붙이고 경로와 그대로 들러붙었다(측정: 손 확인에서
  // 'would install/m/...' 로 나옴). 세 줄 중 가장 긴 이름 + 구분 공백
  // 두 칸으로 폭을 다시 잡는다.
  const width = Math.max(verb.length, 'launcher'.length, 'extension'.length) + 2;
  const lines = [
    `${pad(verb, width)}${paint(payload.manifestPath, COLORS.dim, color)}`,
    `${pad('launcher', width)}${paint(payload.launcherPath, COLORS.dim, color)}`,
    `${pad('extension', width)}${payload.extensionId}`,
  ];
  if (payload.dryRun) {
    lines.push(
      '',
      'manifest:',
      JSON.stringify(payload.manifest, null, 2),
      '',
      'Nothing was written.',
    );
  }
  if (payload.note) lines.push('', payload.note);
  return lines.join('\n');
}

/**
 * 아래 셋은 같은 payload(`lib/bridge/query.ts` 의 `StatusPayload`)를 서로
 * 다르게 읽는다. 넷째인 `state get` 은 그 payload 의 `state` 를 그대로
 * 찍는 한 줄이라 함수가 없다.
 */
function renderRuleList(payload, color) {
  const rules = payload.profile?.headers ?? [];
  if (rules.length === 0) return 'no rules yet';
  const width = {
    id: Math.max(...rules.map((r) => r.id.length)),
    target: Math.max(...rules.map((r) => r.target.length)),
    op: Math.max(...rules.map((r) => r.operation.length)),
  };
  // 키는 `rowKey(profileId, headerRuleId)` = `'<profile> <rule>'` 이다
  // (lib/compile/validate.ts). 브리프는 `key.endsWith(rule.id)` 였는데,
  // 그러면 `r1` 이 `xr1` 의 접미사라 다른 줄의 문제를 뒤집어쓴다 — 키를
  // 지어서 정확히 찾는다. `byRow` 는 모든 프로필의 진단을 담으므로
  // 프로필 id 를 빼면 남의 프로필 문제까지 붙는다.
  const problems = new Map(payload.diagnostics?.byRow ?? []);
  return rules
    .map((rule) => {
      const state = rule.enabled
        ? paint('on ', COLORS.green, color)
        : paint('off', COLORS.dim, color);
      const body = rule.operation === 'remove' ? rule.name : `${rule.name} → ${rule.value}`;
      const trouble = problems.get(`${payload.profile?.id} ${rule.id}`);
      const suffix = trouble?.length ? `  ${paint(trouble[0].message, COLORS.red, color)}` : '';
      return `${pad(rule.id, width.id)}  ${state}  ${pad(rule.target, width.target)}  ${pad(rule.operation, width.op)}  ${body}${suffix}`;
    })
    .join('\n');
}

/**
 * 저장된 목록이 아니라 **실제로 스코프를 정하는 것**을 답한다. all-sites
 * 는 목록을 지우지 않고 컴파일만 안 하므로, 목록을 그대로 찍으면 아무것도
 * 스코프하지 않는 이름들을 스코프라고 말하게 된다 (query.ts 의 같은 주석).
 */
function renderSiteList(payload) {
  if (payload.profile?.filter.allSites) {
    const saved = payload.profile.filter.domains.length;
    const noun = saved === 1 ? 'site is' : 'sites are';
    return `all sites (${saved} saved ${noun} not scoping anything while this mode is on)`;
  }
  const hosts = payload.scopingHosts ?? [];
  return hosts.length === 0 ? 'nothing in scope' : hosts.join('\n');
}

/**
 * 억눌림 이유를 사람의 말로 옮긴다. 슬러그(`no-scope`)는 이 저장소 안의
 * 이름이지 사용자에게 한 말이 아니다. 모르는 이유는 **슬러그 그대로**
 * 흘려보낸다 — 이유가 하나 늘었을 때 조용히 아무 말도 안 하는 것이 여기서
 * 가장 나쁜 결과다.
 */
const SUPPRESSION_WORDS = {
  'no-scope': 'no site is set, and all-sites is off',
  'unusable-site': 'a listed site cannot be used, so the whole rule set fails closed',
};

function renderStatus(payload, color) {
  const lines = [
    `bridge    ${payload.live ? paint('live', COLORS.green, color) : paint('not running', COLORS.amber, color)}`,
  ];

  // 브릿지가 답하지 않았으면 나머지는 **모른다**. 기본값으로 채우면
  // "헤더가 돌고 있고 규칙이 없다" 고 단언하게 되는데, 확인된 적 없는
  // 문장이다. 브리프는 이 갈래를 `tally ?? null` 로만 다뤘고, 그러면
  // 세 줄이 전부 기본값으로 나온다.
  if (payload.state === undefined) {
    lines.push(
      '',
      'The extension holds the rules, so nothing else can be read without a bridge.',
      'Run `headerlab bridge status` to see what is installed.',
    );
    return lines.join('\n');
  }

  const tally = payload.tally ?? null;
  const rules = tally === null ? 'none yet' : `${tally.total} total, ${tally.live} on`;
  const hosts = payload.scopingHosts ?? [];
  const scope = payload.profile?.filter.allSites
    ? 'all sites'
    : hosts.length === 0
      ? paint('nothing in scope', COLORS.amber, color)
      : hosts.join(', ');
  const headers = payload.globalPause
    ? paint('paused', COLORS.amber, color)
    : paint('running', COLORS.green, color);

  lines.push(`headers   ${headers}`, `rules     ${rules}`, `scope     ${scope}`);
  if (payload.suppression !== null && payload.suppression !== undefined) {
    const why = SUPPRESSION_WORDS[payload.suppression] ?? payload.suppression;
    lines.push('', paint(`not applying — ${why}`, COLORS.amber, color));
  }
  lines.push('', 'Location-specific detail: headerlab bridge status');
  return lines.join('\n');
}

export function renderResult(payload, { command, color }) {
  const key = command.join(' ');
  if (key === 'status') return renderStatus(payload, color);
  if (key === 'rule ls') return renderRuleList(payload, color);
  if (key === 'site ls') return renderSiteList(payload);
  if (key === 'state get') return JSON.stringify(payload.state, null, 2);
  if (key === 'bridge status') return renderBridgeStatus(payload, color);
  if (key === 'bridge install') return renderBridgeInstall(payload, color);
  if (key === 'bridge uninstall') {
    return payload.removed?.length ? `removed ${payload.removed.join(', ')}` : 'nothing to remove';
  }
  return renderWrite(payload, command);
}

/** `  <command>   <why>` 두 열. 폭은 이 블록 안에서 가장 긴 명령이 정한다. */
function advice(rows) {
  const width = Math.max(...rows.map(([command]) => command.length)) + 3;
  return rows.map(([command, why]) => `  ${pad(command, width)}${why}`);
}

/**
 * `bridge-off` 만 여러 줄인 이유는 그것이 소켓을 쓰는 모든 명령이 착지하는
 * 가장 흔한 실패이면서, 그 다음에 칠 명령을 아무것도 알려주지 않았기
 * 때문이다 (clig Output §9). 기계용 봉투의 `error.message` 는 첫 문장
 * 그대로다 — 여러 줄 메시지는 파싱하는 쪽에 새 부담이다.
 *
 * **첫 줄은 `error.message` 다.** 한동안 이 갈래는 메시지를 통째로 버리고
 * `no bridge is running.` 을 박아 넣었는데, `bridge-off` 는 모양이 둘이다
 * (`lib/bridge.mjs` 의 `resolveTarget`): 아무것도 안 떠 있으면
 * `no bridge is running`, `--bridge <pid>` 가 없는 pid 를 지목했으면
 * `no live bridge with pid <n>`. 후자에서 박아 넣은 문장은 **다른 브릿지가
 * 살아 있을 때 거짓**이고, 하필 그것이 `--bridge` 가 존재하는 유일한 상황이다.
 * 같은 입력에 `--json` 은 진짜 메시지를 이미 내보내고 있었으니, 사람용만
 * 거짓말을 하고 있었던 셈이다.
 *
 * 그 다음 줄들도 갈린다. 지목한 pid 가 없다는 것은 매니페스트가 없다는 뜻이
 * 아니므로 — 브릿지가 하나라도 떠 있었다면 매니페스트는 이미 설치되어 있다 —
 * `bridge install` 을 권하는 것은 이미 설치된 것을 다시 설치하라는 말이다.
 * 그쪽이 필요한 것은 **살아 있는 pid 목록**이고, 그것을 내는 명령은
 * `bridge status` 다.
 *
 * pid 를 지목했는지는 메시지 문자열이 아니라 `bridgePid` 로 안다 — 문장을
 * 다시 알아보는 구현은 `lib/bridge.mjs` 의 표현을 여기에 한 번 더 적는
 * 것이고, 그 둘이 갈라져도 아무것도 빨개지지 않는다. `argv` 가 usage 줄을
 * 위해 이미 같은 길로 들어오고 있으며(`lib/output.mjs` 의 `planFail`),
 * "사람이 `--bridge` 를 쳤는가" 도 같은 종류의 사실 — 실패의 속성이 아니라
 * 호출의 속성 — 이다.
 */
export function renderError(error, { color, bridgePid = null }) {
  if (error.code === 'bridge-off') {
    const head = paint(`${error.message}.`, COLORS.red, color);
    if (bridgePid !== null) {
      return [
        head,
        ...advice([['headerlab bridge status', 'list the bridges that are live']]),
        'Re-run with a pid from that list, or drop --bridge when only one is live.',
      ].join('\n');
    }
    return [
      head,
      ...advice([
        ['headerlab bridge status', 'see what is installed'],
        ['headerlab bridge install --extension-id <id>', 'if the manifest is missing'],
      ]),
      'Then open the HeaderLab popup and turn on the switch on its Agent bridge',
      'row — the CLI cannot do that step.',
    ].join('\n');
  }
  return paint(error.message, COLORS.red, color);
}

/**
 * 설계 §5.3 — 틀리게 친 명령에는 그 명령의 usage 줄을 메시지 아래 한 줄로
 * 붙인다. 줄은 표(`commands.mjs`)에서 뽑으므로 파서와 어긋날 수 없다.
 *
 * 표에 맞는 명령이 없으면 **아무것도 붙이지 않는다**. `headerlab site` 는
 * `site add` 도 `site rm` 도 아니어서 여기서 고를 usage 가 없고, 하나를
 * 골라 보여 주는 것은 사용자가 치려던 것을 지어내는 일이다.
 *
 * `bin/headerlab.mjs` 안에 있던 것을 옮겨 왔다. 순수한 `(code, argv) →
 * string|null` 인데도 프로세스 안에 갇혀 있어서, 코드마다 붙이는 구현도
 * 한 번도 안 붙이는 구현도 테스트 195 개를 전부 통과했다 — 이 저장소가
 * 되풀이되는 실패 모드라고 이름 붙인 바로 그것이다.
 */
export function usageFor(code, argv) {
  if (code !== 'invalid-args' || argv === null || argv === undefined) return null;
  const entry = findCommand(argv);
  return entry === null ? null : usageLine(entry);
}
