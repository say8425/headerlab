import { parseArgs } from 'node:util';

/**
 * Turns `process.argv.slice(2)` into a bridge command, or a structured error.
 *
 * Pure — no filesystem, no socket, no network. `bin/headerlab.mjs` is the
 * only place in this package allowed to touch any of those, so everything
 * this file returns has to be enough to decide the outcome from argv alone.
 *
 * The nine shapes below are exactly the ones `lib/bridge/protocol.ts`
 * declares (`commandSchema`), field for field. `state.set` is the one
 * exception, and it is exactly the size of the I/O boundary: this file
 * cannot read a file or stdin, so for `state set <file|->` the `state`
 * field holds `{ source }` — the *place* to read from — rather than the
 * AppState itself. `bin/headerlab.mjs` resolves that before the command
 * goes out over the wire, which is why `state` is typed `unknown` in
 * `protocol.ts` in the first place: this layer is not the one that
 * validates it.
 */
export function parse(argv) {
  if (argv.length === 0) {
    return usageError(
      'usage: headerlab <bridge|site|rule|pause|resume|state> ... — see the plugin skill for the full command list',
    );
  }

  const [group, ...rest] = argv;
  switch (group) {
    case 'bridge':
      return parseBridge(rest);
    case 'site':
      return parseSite(rest);
    case 'rule':
      return parseRule(rest);
    case 'pause':
      return parseNullary(rest, 'pause');
    case 'resume':
      return parseNullary(rest, 'resume');
    case 'state':
      return parseState(rest);
    default:
      return unknownCommand(group);
  }
}

function usageError(message) {
  return { ok: false, error: { code: 'usage', message } };
}

function unknownCommand(name) {
  return {
    ok: false,
    error: { code: 'unknown-command', message: `unknown command: ${name ?? '(nothing)'}` },
  };
}

function invalidArgs(message) {
  return { ok: false, error: { code: 'invalid-args', message } };
}

function ok(command) {
  return { ok: true, command };
}

function parseNullary(args, cmd, display = cmd) {
  if (args.length > 0) {
    return invalidArgs(`${display} takes no arguments, got: ${args.join(' ')}`);
  }
  return ok({ cmd });
}

function parseSite(args) {
  const [sub, ...rest] = args;
  if (sub === 'add' || sub === 'rm') {
    // `allowPositionals: true` 로 파싱하는 이유는 도메인을 받기 위해서가
    // 아니라 **플래그를 거부하기 위해서**다. 이전에는 남은 토큰을 전부
    // 도메인으로 삼았고, `site add a.com --json` 이 exit 0 으로 성공하며
    // `--json` 을 도메인으로 저장했다 — `effectiveDomain` 이 그대로 저장하고
    // `suppressionReason` 이 `unusable-site` 를 돌려주어 프로필 전체가
    // 컴파일을 멈춘다. 같은 CLI 의 `bridge status` 는 이미 이렇게 거부한다.
    let positionals;
    try {
      ({ positionals } = parseArgs({ args: rest, options: {}, allowPositionals: true }));
    } catch (error) {
      return invalidArgs(`site ${sub}: ${error.message}`);
    }
    if (positionals.length === 0) {
      return invalidArgs(`site ${sub} needs at least one domain`);
    }
    return ok({ cmd: sub === 'add' ? 'site.add' : 'site.remove', domains: positionals });
  }
  if (sub === 'all-sites') {
    const [state] = rest;
    if (state !== 'on' && state !== 'off') {
      return invalidArgs(`site all-sites needs "on" or "off", got: ${state ?? '(nothing)'}`);
    }
    return ok({ cmd: 'site.allSites', on: state === 'on' });
  }
  return invalidArgs(`unknown site command: ${sub ?? '(nothing)'}`);
}

const RULE_TARGETS = ['request', 'response'];
const RULE_OPERATIONS = ['set', 'append', 'remove'];

function parseRule(args) {
  const [sub, ...rest] = args;
  if (sub === 'add') return parseRuleAdd(rest);
  if (sub === 'rm') return parseRuleRemove(rest);
  if (sub === 'toggle') return parseRuleToggle(rest);
  return invalidArgs(`unknown rule command: ${sub ?? '(nothing)'}`);
}

function parseRuleAdd(args) {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        target: { type: 'string' },
        op: { type: 'string' },
        name: { type: 'string' },
        value: { type: 'string' },
        'value-file': { type: 'string' },
      },
      allowPositionals: false,
    }));
  } catch (error) {
    return invalidArgs(`rule add: ${error.message}`);
  }

  if (!RULE_TARGETS.includes(values.target)) {
    return invalidArgs(
      `rule add needs --target ${RULE_TARGETS.join('|')}, got: ${values.target ?? '(missing)'}`,
    );
  }
  if (!RULE_OPERATIONS.includes(values.op)) {
    return invalidArgs(
      `rule add needs --op ${RULE_OPERATIONS.join('|')}, got: ${values.op ?? '(missing)'}`,
    );
  }
  // 둘 중 하나가 조용히 이기면, 비밀값을 파일에 두려던 사람이 왜
  // argv 의 값이 나갔는지 알 길이 없다.
  if (values.value !== undefined && values['value-file'] !== undefined) {
    return invalidArgs('rule add takes --value or --value-file, not both');
  }

  // `{source}` 는 `state.set` 이 이미 쓰는 형태다 — 이 파일은 순수하므로
  // 파일을 읽지 않고 *읽을 자리*를 실어 보내고, bin/headerlab.mjs 가
  // 소켓 이전에 해소한다.
  const value =
    values['value-file'] === undefined ? (values.value ?? '') : { source: values['value-file'] };

  // `name` and `value` both default to '' rather than being required: a
  // nameless, valueless rule is a normal state in this repo (`newRule` in
  // defaults.ts is exactly that), and `protocol.ts` accepts it on purpose —
  // see its comment on `commandSchema`'s `rule.add` branch.
  return ok({
    cmd: 'rule.add',
    target: values.target,
    operation: values.op,
    name: values.name ?? '',
    value,
  });
}

function parseRuleRemove(args) {
  const [id] = args;
  if (!id) return invalidArgs('rule rm needs an id');
  return ok({ cmd: 'rule.remove', id });
}

function parseRuleToggle(args) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args,
      options: { on: { type: 'boolean' }, off: { type: 'boolean' } },
      allowPositionals: true,
    }));
  } catch (error) {
    return invalidArgs(`rule toggle: ${error.message}`);
  }

  const [id] = positionals;
  if (!id) return invalidArgs('rule toggle needs an id');
  if (values.on && values.off) {
    return invalidArgs('rule toggle cannot take both --on and --off');
  }

  const command = { cmd: 'rule.toggle', id };
  // Omitting `on` entirely — not defaulting it to `true` or `false` — is
  // the point. `protocol.ts` treats a missing `on` as "flip it", and the
  // reducer needs to read current state to do that; a CLI-side default
  // would force a read before every toggle that this command is meant to
  // avoid.
  if (values.on) command.on = true;
  else if (values.off) command.on = false;
  return ok(command);
}

function parseState(args) {
  const [sub, ...rest] = args;
  if (sub !== 'set') {
    return invalidArgs(`unknown state command: ${sub ?? '(nothing)'}`);
  }
  const [source] = rest;
  if (!source) {
    return invalidArgs('state set needs a file path or "-" for stdin');
  }
  return ok({ cmd: 'state.set', state: { source } });
}

const BRIDGE_BROWSERS = ['chrome', 'chromium'];

/**
 * `bridge` is the one group that never reaches a socket — it is what makes a
 * socket possible. `bin/headerlab.mjs` branches on the `bridge.` prefix before
 * it resolves a target, because "no bridge is running" is the normal state for
 * someone typing `bridge install`.
 *
 * Stays pure like the rest of this file: `--load-path` is carried through as
 * the text that was typed, not resolved and hashed here. Turning it into an
 * extension id means resolving it against `process.cwd()`, which is I/O this
 * layer does not do.
 */
function parseBridge(args) {
  const [sub, ...rest] = args;
  if (sub === 'uninstall' || sub === 'status') {
    return parseBridgeLocation(rest, `bridge.${sub}`, `bridge ${sub}`);
  }
  if (sub !== 'install') {
    return invalidArgs(`unknown bridge command: ${sub ?? '(nothing)'}`);
  }
  return parseBridgeInstall(rest);
}

/**
 * Refused rather than accepted-and-ignored: an unsupported `--browser` here
 * is the same mistake `bridge install` refuses, and letting it through
 * silently on `uninstall`/`status` would mean each learns the allowlist on
 * its own, out of step with `install`'s.
 */
function validateBrowser(browser, display) {
  if (!BRIDGE_BROWSERS.includes(browser)) {
    return invalidArgs(`${display} needs --browser ${BRIDGE_BROWSERS.join('|')}, got: ${browser}`);
  }
  return null;
}

/**
 * `bridge uninstall` and `bridge status` — no extension id, no load path,
 * but the same `--user-data-dir`/`--browser` pair `bridge install` takes,
 * because both read back exactly what `install` wrote *to* that pair.
 * Without this, `status` could only ever answer for the default
 * chrome/homedir location: a status command that silently under-reports a
 * bridge installed to a different `--browser` or `--user-data-dir` is
 * wrong, not merely incomplete — the one direction this repo does not
 * forgive (see CLAUDE.md's "no silent failures").
 */
function parseBridgeLocation(args, cmd, display) {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        'user-data-dir': { type: 'string' },
        browser: { type: 'string' },
      },
      allowPositionals: false,
    }));
  } catch (error) {
    return invalidArgs(`${display}: ${error.message}`);
  }

  const browser = values.browser ?? 'chrome';
  const browserError = validateBrowser(browser, display);
  if (browserError) return browserError;

  return ok({ cmd, userDataDir: values['user-data-dir'] ?? null, browser });
}

function parseBridgeInstall(args) {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        'extension-id': { type: 'string' },
        'load-path': { type: 'string' },
        'user-data-dir': { type: 'string' },
        browser: { type: 'string' },
      },
      allowPositionals: false,
    }));
  } catch (error) {
    return invalidArgs(`bridge install: ${error.message}`);
  }

  const extensionId = values['extension-id'] ?? null;
  const loadPath = values['load-path'] ?? null;
  if (extensionId === null && loadPath === null) {
    return invalidArgs(
      'bridge install needs --extension-id <id> (copy it from chrome://extensions) or ' +
        '--load-path <dir> (the unpacked directory Chrome was pointed at)',
    );
  }
  // Refused rather than resolved by precedence. `allowed_origins` takes one
  // exact origin and no wildcard, so a silent winner between two ids is a
  // manifest Chrome rejects with the same message it gives for a host that
  // does not exist.
  if (extensionId !== null && loadPath !== null) {
    return invalidArgs('bridge install takes --extension-id or --load-path, not both');
  }

  const browser = values.browser ?? 'chrome';
  const browserError = validateBrowser(browser, 'bridge install');
  if (browserError) return browserError;

  return ok({
    cmd: 'bridge.install',
    extensionId,
    loadPath,
    userDataDir: values['user-data-dir'] ?? null,
    browser,
  });
}
