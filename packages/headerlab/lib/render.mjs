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
