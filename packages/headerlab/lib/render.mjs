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

export const COLORS = {
  reset: '[0m',
  dim: '[2m',
  red: '[31m',
  green: '[32m',
  amber: '[33m',
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

function renderWrite(payload, command) {
  const summary =
    command[0] === 'site'
      ? scopeSummary(payload.state)
      : command[0] === 'rule'
        ? ruleSummary(payload.state)
        : pauseSummary(payload.state);
  if (payload.changed === false) return `nothing changed — ${summary}`;
  return summary;
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
  const launcher = payload.launcherMissing
    ? paint('missing', COLORS.red, color)
    : payload.entryMissing
      ? paint('entry missing', COLORS.amber, color)
      : paint('ok', COLORS.green, color);
  const live =
    payload.liveBridges.length === 0
      ? 'not running'
      : `${payload.liveBridges.length} live (${payload.liveBridges.map((b) => `pid ${b.pid}`).join(', ')})`;

  return [
    `manifest  ${pad(manifest, 15)}${paint(payload.manifestPath, COLORS.dim, color)}`,
    `launcher  ${pad(launcher, 15)}${paint(payload.launcherPath, COLORS.dim, color)}`,
    `bridge    ${live}`,
  ]
    .map((line) => line.trimEnd())
    .join('\n');
}

function renderBridgeInstall(payload, color) {
  const lines = [
    `installed  ${paint(payload.manifestPath, COLORS.dim, color)}`,
    `launcher   ${paint(payload.launcherPath, COLORS.dim, color)}`,
    `extension  ${payload.extensionId}`,
  ];
  if (payload.note) lines.push('', payload.note);
  return lines.join('\n');
}

export function renderResult(payload, { command, color }) {
  const key = command.join(' ');
  if (key === 'bridge status') return renderBridgeStatus(payload, color);
  if (key === 'bridge install') return renderBridgeInstall(payload, color);
  if (key === 'bridge uninstall') {
    return payload.removed?.length ? `removed ${payload.removed.join(', ')}` : 'nothing to remove';
  }
  return renderWrite(payload, command);
}

/**
 * `bridge-off` 만 여러 줄인 이유는 그것이 소켓을 쓰는 모든 명령이 착지하는
 * 가장 흔한 실패이면서, 그 다음에 칠 명령을 아무것도 알려주지 않았기
 * 때문이다 (clig Output §9). 기계용 봉투의 `error.message` 는 첫 문장
 * 그대로다 — 여러 줄 메시지는 파싱하는 쪽에 새 부담이다.
 */
export function renderError(error, { color }) {
  if (error.code === 'bridge-off') {
    return [
      paint('no bridge is running.', COLORS.red, color),
      `  ${pad('headerlab bridge status', 47)}see what is installed`,
      `  ${pad('headerlab bridge install --extension-id <id>', 47)}if the manifest is missing`,
      'Then open the HeaderLab popup and press Enable on the bridge row — the CLI',
      'cannot do that step.',
    ].join('\n');
  }
  return paint(error.message, COLORS.red, color);
}
