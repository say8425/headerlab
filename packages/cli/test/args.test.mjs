import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from '../lib/args.mjs';

// One deepEqual per command name, matching lib/bridge/protocol.ts's
// `commandSchema` field for field. `state.set` is the one that cannot be a
// literal field-for-field match — see args.mjs's docblock — so it gets its
// own comment below rather than being silently different from the other
// eight.

test('site add', () => {
  assert.deepEqual(parse(['site', 'add', 'a.example.com']), {
    ok: true,
    command: { cmd: 'site.add', domains: ['a.example.com'] },
  });
});

test('site add takes more than one domain', () => {
  assert.deepEqual(parse(['site', 'add', 'a.example.com', 'b.example.com']), {
    ok: true,
    command: { cmd: 'site.add', domains: ['a.example.com', 'b.example.com'] },
  });
});

test('site rm', () => {
  assert.deepEqual(parse(['site', 'rm', 'a.example.com']), {
    ok: true,
    command: { cmd: 'site.remove', domains: ['a.example.com'] },
  });
});

test('site all-sites on', () => {
  assert.deepEqual(parse(['site', 'all-sites', 'on']), {
    ok: true,
    command: { cmd: 'site.allSites', on: true },
  });
});

test('site all-sites off', () => {
  assert.deepEqual(parse(['site', 'all-sites', 'off']), {
    ok: true,
    command: { cmd: 'site.allSites', on: false },
  });
});

test('rule add with its flags', () => {
  assert.deepEqual(
    parse(['rule', 'add', '--target', 'response', '--op', 'set', '--name', 'X', '--value', '1']),
    {
      ok: true,
      command: { cmd: 'rule.add', target: 'response', operation: 'set', name: 'X', value: '1' },
    },
  );
});

// A wrong implementation that hardcodes `value: values.value` (no `?? ''`)
// would pass every other rule-add test and fail only this one — that is
// exactly the shape of bug this test exists to catch, and it is the case
// the CLI spelling `--op remove` (no `--value`) hits in practice.
test('rule add --op remove produces a command whose value is empty', () => {
  assert.deepEqual(
    parse(['rule', 'add', '--target', 'request', '--op', 'remove', '--name', 'X-Foo']),
    {
      ok: true,
      command: {
        cmd: 'rule.add',
        target: 'request',
        operation: 'remove',
        name: 'X-Foo',
        value: '',
      },
    },
  );
});

test('rule add without --name or --value defaults both to empty — a blank rule is valid', () => {
  assert.deepEqual(parse(['rule', 'add', '--target', 'request', '--op', 'set']), {
    ok: true,
    command: { cmd: 'rule.add', target: 'request', operation: 'set', name: '', value: '' },
  });
});

test('rule add rejects an unknown --target', () => {
  const result = parse(['rule', 'add', '--target', 'sideways', '--op', 'set', '--name', 'X']);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /--target/);
});

test('rule add rejects an unknown --op', () => {
  const result = parse(['rule', 'add', '--target', 'request', '--op', 'nope', '--name', 'X']);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /--op/);
});

test('rule rm', () => {
  assert.deepEqual(parse(['rule', 'rm', 'rule-1']), {
    ok: true,
    command: { cmd: 'rule.remove', id: 'rule-1' },
  });
});

test('rule rm needs an id', () => {
  const result = parse(['rule', 'rm']);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /id/);
});

// The reducer treats a missing `on` as "flip it" (protocol.ts). Defaulting
// it here — to `true`, to `false`, or to the current value — would be wrong
// in three different ways, and a wrong implementation that defaults to
// `true` would still pass a test that merely checked `on !== false`. Only
// asserting the key is entirely absent catches that.
test('rule toggle with neither --on nor --off omits `on` entirely', () => {
  const result = parse(['rule', 'toggle', 'rule-1']);
  assert.deepEqual(result, { ok: true, command: { cmd: 'rule.toggle', id: 'rule-1' } });
  assert.equal('on' in result.command, false);
});

test('rule toggle --on', () => {
  assert.deepEqual(parse(['rule', 'toggle', 'rule-1', '--on']), {
    ok: true,
    command: { cmd: 'rule.toggle', id: 'rule-1', on: true },
  });
});

test('rule toggle --off', () => {
  assert.deepEqual(parse(['rule', 'toggle', 'rule-1', '--off']), {
    ok: true,
    command: { cmd: 'rule.toggle', id: 'rule-1', on: false },
  });
});

test('rule toggle rejects both --on and --off', () => {
  const result = parse(['rule', 'toggle', 'rule-1', '--on', '--off']);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /--on.*--off|both/);
});

test('pause', () => {
  assert.deepEqual(parse(['pause']), { ok: true, command: { cmd: 'pause' } });
});

test('pause takes no arguments', () => {
  const result = parse(['pause', 'now']);
  assert.equal(result.ok, false);
});

test('resume', () => {
  assert.deepEqual(parse(['resume']), { ok: true, command: { cmd: 'resume' } });
});

// This is the field-level exception the docblock in args.mjs names: `state`
// holds `{ source }` (where to read from) rather than parsed AppState,
// because parse() has no filesystem access to do that resolution itself.
// The `cmd`/`state` field *names* still match protocol.ts exactly — only
// the content of `state` is a placeholder bin/headerlab.mjs fills in later.
test('state set names its source without reading it', () => {
  assert.deepEqual(parse(['state', 'set', 'snapshot.json']), {
    ok: true,
    command: { cmd: 'state.set', state: { source: 'snapshot.json' } },
  });
});

test('state set - names stdin as the source', () => {
  assert.deepEqual(parse(['state', 'set', '-']), {
    ok: true,
    command: { cmd: 'state.set', state: { source: '-' } },
  });
});

test('state set needs a source', () => {
  const result = parse(['state', 'set']);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /file path|stdin/);
});

test('a command that would change nothing is refused, not accepted quietly', () => {
  const result = parse(['site', 'add']);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /at least one/);
});

test('site rm with no domain is refused the same way', () => {
  const result = parse(['site', 'rm']);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /at least one/);
});

test('names the command it does not know', () => {
  const result = parse(['teleport']);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /teleport/);
});

test('names the unknown subcommand too, not just the group', () => {
  const result = parse(['site', 'teleport']);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /teleport/);
});

test('an empty argv asks for help rather than failing obscurely', () => {
  const result = parse([]);
  assert.equal(result.ok, false);
  assert.match(result.error.code, /usage/);
});

test('site all-sites rejects a value other than on/off', () => {
  const result = parse(['site', 'all-sites', 'sideways']);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /on.*off|off.*on/);
});
