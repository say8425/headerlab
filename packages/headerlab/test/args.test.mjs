import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';
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

describe('bridge', () => {
  it('takes an extension id verbatim', () => {
    assert.deepEqual(parse(['bridge', 'install', '--extension-id', 'abc']), {
      ok: true,
      command: {
        cmd: 'bridge.install',
        extensionId: 'abc',
        loadPath: null,
        userDataDir: null,
        browser: 'chrome',
      },
    });
  });

  it('takes a load path instead, to be turned into an id later', () => {
    // Kept as a path here rather than resolved: this file is pure, and
    // resolving means hashing the *absolute* path, which needs process.cwd().
    assert.deepEqual(parse(['bridge', 'install', '--load-path', '.output/chrome-mv3']), {
      ok: true,
      command: {
        cmd: 'bridge.install',
        extensionId: null,
        loadPath: '.output/chrome-mv3',
        userDataDir: null,
        browser: 'chrome',
      },
    });
  });

  it('refuses install with neither', () => {
    const result = parse(['bridge', 'install']);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'invalid-args');
    assert.match(result.error.message, /--extension-id|--load-path/);
  });

  it('refuses install with both — one of them would silently win', () => {
    const result = parse(['bridge', 'install', '--extension-id', 'abc', '--load-path', '/x']);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'invalid-args');
  });

  it('accepts the browser it should install for', () => {
    assert.deepEqual(
      parse(['bridge', 'install', '--extension-id', 'abc', '--browser', 'chromium']).command
        .browser,
      'chromium',
    );
  });

  it('refuses a browser it has no directory for', () => {
    const result = parse(['bridge', 'install', '--extension-id', 'abc', '--browser', 'firefox']);
    assert.equal(result.ok, false);
    assert.match(result.error.message, /firefox/);
  });

  it('parses uninstall and status with no arguments, defaulting the same as install', () => {
    assert.deepEqual(parse(['bridge', 'uninstall']), {
      ok: true,
      command: { cmd: 'bridge.uninstall', userDataDir: null, browser: 'chrome' },
    });
    assert.deepEqual(parse(['bridge', 'status']), {
      ok: true,
      command: { cmd: 'bridge.status', userDataDir: null, browser: 'chrome' },
    });
  });

  // The gap the team lead flagged: uninstall/status could only ever look at
  // the default chrome/homedir location, so a bridge installed with
  // --browser chromium was invisible to both — status answering "not
  // installed" about a directory it never looked in, not merely an
  // incomplete answer. A wrong implementation that accepts the flag and
  // drops it would pass a presence-only check; only a full deepEqual on the
  // command, matching what --browser was actually given, catches that.
  it('takes --user-data-dir and --browser on uninstall and status too, not just install', () => {
    assert.deepEqual(parse(['bridge', 'status', '--browser', 'chromium']), {
      ok: true,
      command: { cmd: 'bridge.status', userDataDir: null, browser: 'chromium' },
    });
    assert.deepEqual(parse(['bridge', 'uninstall', '--user-data-dir', '/tmp/profile']), {
      ok: true,
      command: { cmd: 'bridge.uninstall', userDataDir: '/tmp/profile', browser: 'chrome' },
    });
  });

  it('refuses a browser it has no directory for on uninstall and status too', () => {
    const status = parse(['bridge', 'status', '--browser', 'firefox']);
    assert.equal(status.ok, false);
    assert.match(status.error.message, /firefox/);

    const uninstall = parse(['bridge', 'uninstall', '--browser', 'firefox']);
    assert.equal(uninstall.ok, false);
    assert.match(uninstall.error.message, /firefox/);
  });

  // uninstall/status take no positionals — neither has anything left over
  // for one to name — and the message must still read as what was typed
  // ("bridge uninstall"), not the internal command name ("bridge.uninstall").
  it('names the error after what was typed when a stray positional sneaks in', () => {
    const result = parse(['bridge', 'uninstall', 'extra']);
    assert.equal(result.ok, false);
    assert.match(result.error.message, /^bridge uninstall:/);
    assert.match(result.error.message, /extra/);
  });

  it('names the unknown subcommand rather than the group', () => {
    const result = parse(['bridge', 'reinstall']);
    assert.equal(result.ok, false);
    assert.match(result.error.message, /reinstall/);
  });
});

// The brief this test comes from expected the bare parseArgs message,
// `"Unknown option '--nope'"`. Measured on this repo's pinned Node (24.16.0,
// per .nvmrc's `24`): node:util's parseArgs appends a second sentence to
// ERR_PARSE_ARGS_UNKNOWN_OPTION suggesting `--` for a positional starting
// with `-`, so the actual message is longer. Asserted against the real
// output rather than the brief's, since a literal transcription would fail
// on the Node version this repo actually runs.
test('site add 는 플래그처럼 생긴 토큰을 도메인으로 저장하지 않는다', () => {
  assert.deepEqual(parse(['site', 'add', 'a.com', '--nope']), {
    ok: false,
    error: {
      code: 'invalid-args',
      message:
        "site add: Unknown option '--nope'. To specify a positional argument starting with a " +
        `'-', place it at the end of the command after '--', as in '-- "--nope"`,
    },
  });
});

test('site rm 도 같다', () => {
  assert.deepEqual(parse(['site', 'rm', '--nope']), {
    ok: false,
    error: {
      code: 'invalid-args',
      message:
        "site rm: Unknown option '--nope'. To specify a positional argument starting with a " +
        `'-', place it at the end of the command after '--', as in '-- "--nope"`,
    },
  });
});

test('site add 는 여전히 여러 도메인을 받는다', () => {
  assert.deepEqual(parse(['site', 'add', 'a.com', 'b.com']), {
    ok: true,
    command: { cmd: 'site.add', domains: ['a.com', 'b.com'] },
  });
});
