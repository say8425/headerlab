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
      'usage: headerlab <site|rule|pause|resume|state> ... — see the plugin skill for the full command list',
    );
  }

  const [group, ...rest] = argv;
  switch (group) {
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

function parseNullary(args, cmd) {
  if (args.length > 0) {
    return invalidArgs(`${cmd} takes no arguments, got: ${args.join(' ')}`);
  }
  return ok({ cmd });
}

function parseSite(args) {
  const [sub, ...rest] = args;
  if (sub === 'add' || sub === 'rm') {
    if (rest.length === 0) {
      return invalidArgs(`site ${sub} needs at least one domain`);
    }
    return ok({ cmd: sub === 'add' ? 'site.add' : 'site.remove', domains: rest });
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

  // `name` and `value` both default to '' rather than being required: a
  // nameless, valueless rule is a normal state in this repo (`newRule` in
  // defaults.ts is exactly that), and `protocol.ts` accepts it on purpose —
  // see its comment on `commandSchema`'s `rule.add` branch.
  return ok({
    cmd: 'rule.add',
    target: values.target,
    operation: values.op,
    name: values.name ?? '',
    value: values.value ?? '',
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
