# Agent bridge

English | [한국어](agent-bridge.ko.md) | [日本語](agent-bridge.ja.md) | [中文](agent-bridge.zh.md) | [Español](agent-bridge.es.md)

Part of [HeaderLab](../README.md).

An AI agent can drive HeaderLab from a terminal instead of a person clicking through the
popup:

```bash
headerlab site add staging.example.com
headerlab rule add --target request --op set --name Authorization --value "Bearer $TOKEN"
```

On a terminal it prints for people; piped or with `--json` it prints one JSON object,
success or failure. `--human` is the inverse of `--json`: it forces the human-readable
form even through a pipe, which is what you want when a log is going to be read by a
person rather than parsed. Passing both is a contradiction rather than a precedence
question, so the CLI refuses it and exits 2 without doing anything. The exit code names
the failure class:

| Exit | Meaning |
|---|---|
| `0` | Success |
| `2` | Your input — the CLI refused it and nothing left the machine |
| `3` | No bridge to talk to |
| `4` | Connected, but the exchange failed |
| `1` | The extension refused the request |

```
CLI (headerlab)                      Native host              Extension (SW)
node, zero deps                       node, zero deps          lib/bridge/
   │                                      │                        │
   │  unix socket                         │  stdio                 │
   │  <per-user tmp>/headerlab/…sock      │  (4-byte length + JSON)│
   └──────── one JSON line ──────────────►├───────────────────────►│
            request/response              │                    apply()
   ◄──────────────────────────────────────┤◄───────────────────────┤
                                          │                   local:state
                                          │                        ▼
                                     Chrome launches         reconcile()
                                     and kills it        (existing single loop)
```

**The direction is the one fact this diagram exists to carry: the host cannot speak to the
extension first.** Chromium does have a native-initiated connection path, but it sits
behind a flag that ships off by default, so the design treats the extension as the only
initiator. It opens the port, Chrome starts the host process as a side effect, the host
listens on a unix socket, and the CLI is what attaches to it — never the other way around.
A write travels in as one JSON line, crosses to the extension framed over stdio, is applied
to `local:state`, and is picked up by the same `reconcile()` every other trigger already
funnels into: **a new trigger, not a new writer.**

## Commands

Four read and change nothing: `status`, `site ls`, `rule ls` and `state get`. They send
one query and answer from the same pure functions the popup renders from, so what the CLI
says and what the rail shows cannot drift apart.

```bash
headerlab status
headerlab state get --json | jq .state | headerlab state set - --force
```

`status` is the one command that treats a missing bridge as a fact rather than an error —
it answers from what is installed locally, says `live: false`, and exits 0, the way `git
status` works in a repository with no commits. The other three exit 3.

Nine travel over the bridge socket as writes: `site add|rm` and `site all-sites on|off` to
scope the rule set, `rule add|rm|toggle` to edit header rules, `pause`/`resume` to stop and
restart the whole set, and `state set <file|->` to replace stored state wholesale — which
requires `--force` when stdin is not a terminal, because it is an overwrite with no undo.

Three more never touch that socket — they manage the native-messaging host manifest and the
launcher script Chrome runs, which is what makes a socket possible in the first place:
`bridge install`, `bridge uninstall`, and `bridge status` (which reports `entryMissing`
when the launcher points at a file that is no longer there — the symptom of `npm uninstall
-g headerlab`, an upgrade, or an nvm switch that moves the global prefix. Re-running
`bridge install` fixes it).

The full reference — flags and error codes — lives in
[`packages/plugin/skills/headerlab/SKILL.md`](../packages/plugin/skills/headerlab/SKILL.md).

## Five claims not to get wrong

These are the product's own claims. Getting them wrong here would be worse than leaving
this document out.

- **The bridge is off until a human turns it on.** It rides `nativeMessaging` as an
  optional permission, requested from a button in the popup, behind Chrome's own consent
  dialog — the install-time `permissions` list does not change. Measured, not assumed:
  [`docs/research/2026-08-11-native-messaging-spike.md`](research/2026-08-11-native-messaging-spike.md)
  records the grant dialog firing, and the grant surviving a second connection with no
  dialog at all.
- **The CLI cannot grant site permissions.** `site add` and `site all-sites on` only change
  what a rule is *scoped* to — the row still sits pending until a person clicks **Grant**,
  same as a site added by hand. Chrome requires a user gesture for a permission grant, and
  that limit is kept rather than worked around.
- **The CLI cannot turn the bridge on either.** `chrome.permissions.request()` requires a
  user gesture to resolve. There is no `headerlab bridge enable` and there will not be one
  that works: `bridge install` beside a bridge nobody has pressed **Enable** for just writes
  files that never connect.
- **Nothing leaves the machine.** CLI, host and extension only ever talk over a unix domain
  socket in a permission-restricted, per-user directory — never a network socket. **Not
  `$TMPDIR`**, deliberately: `socketDir()` asks the OS (`getconf DARWIN_USER_TEMP_DIR`, by
  absolute path) rather than reading whichever `$TMPDIR` each process happened to inherit,
  because the host inherits Chrome's environment and the CLI inherits the terminal's — two
  copies that can disagree with nothing failing to show it. One variable does override it,
  `HEADERLAB_SOCKET_DIR`, and that is read once *inside* the function rather than by either
  call site, for the same reason. `tests/unit/outbound.test.ts` bans outbound
  primitives — `fetch`, `WebSocket`, `node:https`, a `.listen(<port-number>)` call — from
  every `.mjs` under `packages/headerlab/`, and its own docblock says what it cannot see:
  the port check matches a literal digit in source, so `server.listen(8080)` is caught and
  `server.listen(tcpPort)` would not be. Written down rather than left implied, because
  overstating a security guarantee is the one thing this repository would rather not do.
- **This build refuses a regex filter.** `state set` validates the payload, but the popup
  has no regex editor and nothing here calls
  `chrome.declarativeNetRequest.isRegexSupported()` — the only authority on whether a
  pattern is valid RE2 — so a `filter.mode: 'regex'` rule would apply invisibly, headers
  changing with no screen able to show the pattern responsible. `lib/bridge/port.ts` rejects
  such a payload outright, with the error code `unsupported`, until a regex editor exists to
  go with it ([#33](https://github.com/say8425/headerlab/issues/33)).

## Turning it on

1. Press **Enable** on the popup's bridge row — it reads **Bridge off** until then. This
   asks Chrome for the `nativeMessaging` permission through its own consent dialog.
2. Run the installer, copying the id from `chrome://extensions`:

   ```bash
   headerlab bridge install --extension-id <id>
   ```

3. The popup now reads **Bridge live**.

`--extension-id` is the instruction the CLI's own README leads with too, because it is the
one that always applies — someone who installed the CLI from npm has no extension directory
to point at. `--load-path <dir>` is the alternative when you are working on a local unpacked
build and the path is already at hand, but it is a footgun as much as a convenience: a
symlink, a trailing slash, or a differently spelled path to the same directory each hash to
a different id, and a mismatched manifest installs cleanly and simply never connects.

Either way the installer reports back exactly which id it used, because nothing inside the
CLI can check that against what Chrome actually loaded. Comparing the echoed id against
`chrome://extensions` is the only check there is — `tests/e2e/bridge.spec.ts` does exactly
that against a running browser.

**Packaging.** `packages/headerlab` ships the `headerlab` command **and** the host Chrome
launches, as one package rather than two. `bridge install` writes a launcher naming the
host's entry file by absolute path; a CLI published without the host would still write that
launcher — the install step cannot see that the file it names does not exist on the target
machine — and Chrome reports the resulting failure the same way it reports a rejected
manifest or a mismatched id. Shipping both from the one tarball makes that failure mode
structurally impossible.

Two things the design's own §2/§3 named still do not exist: `headerlab diagnostics`, which
will not be built because `status` carries the same payload and a second name for one query
is not a feature, and the snapshot-before-every-raw-write that `state snapshots`/`state
restore <id>` would read back
([#35](https://github.com/say8425/headerlab/issues/35)). `state set` validates against the
schema and requires `--force`; it keeps no history.
