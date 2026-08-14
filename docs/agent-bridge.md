# Agent bridge

An AI agent drives HeaderLab from a terminal instead of a person clicking through the
popup — turning "add a Bearer token to staging" into one command instead of six manual
clicks.

The README has the short version. This document is the design: how the three processes
find each other, which direction they may speak in, and the five things a reader must not
come away misled about.

## Shape

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

A write travels in as one JSON line over that socket, crosses to the extension framed over
stdio, is applied to `local:state`, and is picked up by the same `reconcile()` every other
trigger already funnels into: **a new trigger, not a new writer.**

## Packaging

`packages/headerlab` ships the `headerlab` command **and** the native-messaging host that
Chrome launches, as one package rather than two. That is not tidiness: `bridge install`
writes a launcher that names the host's entry file by absolute path. A CLI published
without the host would still write that launcher — the install step cannot see that the
file it is naming does not exist on the target machine — and Chrome reports the resulting
failure with the same message it uses for a rejected manifest or a mismatched extension
id, indistinguishable without reading the log by hand. Shipping both from the one tarball
`bridge install` reads makes that failure mode structurally impossible.

`packages/plugin` packages the CLI as a skill for Claude Code and Codex, from one
`skills/` tree under two manifests. Both packages have zero runtime dependencies;
only `packages/headerlab` is published to npm.

## Commands

Nine commands travel over the bridge socket:

| Command | What it does |
| --- | --- |
| `site add <host>` / `site rm <host>` | Scope the rule set to a site |
| `site all-sites on\|off` | Switch the explicit apply-everywhere mode |
| `rule add` / `rule rm` / `rule toggle` | Edit header rules |
| `pause` / `resume` | Stop or restart the whole rule set |
| `state set <file\|->` | Replace stored state wholesale |

Three more never touch that socket at all — they manage the native-messaging host manifest
and the launcher script Chrome runs, which is what makes a socket possible in the first
place:

| Command | What it does |
| --- | --- |
| `bridge install` | Write the host manifest and launcher |
| `bridge uninstall` | Remove them |
| `bridge status` | Report what is installed, including `entryMissing` |

Every reply is one JSON object on stdout — success or failure — with the exit code
following it. There is no human-readable output to parse instead.

```bash
headerlab site add staging.example.com
headerlab rule add --target request --op set --name Authorization --value "Bearer $TOKEN"
```

The full reference — flags, error codes, and what each command does and does not do —
lives in [`packages/plugin/skills/headerlab/SKILL.md`](../packages/plugin/skills/headerlab/SKILL.md),
shared unchanged between the two plugin manifests.

## Five claims not to get wrong

These are the product's own claims. Getting them wrong here would be worse than leaving
this document out.

**The bridge is off until a human turns it on.** It rides `nativeMessaging` as an optional
permission, requested from a button in the popup, behind Chrome's own consent dialog — the
install-time `permissions` list does not change. Measured, not assumed:
[`docs/research/2026-08-11-native-messaging-spike.md`](research/2026-08-11-native-messaging-spike.md)
records the grant dialog firing, and the grant surviving a second connection with no dialog
at all.

**The CLI cannot grant site permissions.** `site add` and `site all-sites on` only change
what a rule is *scoped* to — the row still sits pending until a person clicks **Grant** in
the popup, same as a site added by hand. Chrome requires a user gesture for a permission
grant, and that limit is kept rather than worked around.

**The CLI cannot turn the bridge on either.** `chrome.permissions.request()` requires a
user gesture to resolve. There is no `headerlab bridge enable` and there will not be one
that works: `bridge install` beside a bridge nobody has pressed **Enable** for just writes
files that never connect.

**Nothing leaves the machine.** CLI, host and extension only ever talk over a unix domain
socket in a permission-restricted, per-user directory — never a network socket. **Not
`$TMPDIR`**, and the difference is deliberate: `socketDir()` in
`packages/headerlab/lib/socket.mjs` asks the OS (`getconf DARWIN_USER_TEMP_DIR`, by
absolute path) rather than trusting an inherited environment variable, because the host
inherits Chrome's environment and the CLI inherits the terminal's — two copies that can
disagree with nothing failing to show it. `tests/unit/outbound.test.ts` bans outbound primitives — `fetch`,
`WebSocket`, `node:https`, a `.listen(<port-number>)` call — from every `.mjs` under
`packages/headerlab/`, and its own docblock says what it cannot see: the port check matches a literal
digit in source, so `server.listen(8080)` is caught and `server.listen(tcpPort)` would not
be. That is written down rather than left implied, because overstating a security
guarantee is the one thing this repository would rather not do.

**This build refuses a regex filter.** `state set` validates the payload, but the popup has
no regex editor and nothing here calls `chrome.declarativeNetRequest.isRegexSupported()` —
the only authority on whether a pattern is valid RE2 — so a `filter.mode: 'regex'` rule
would apply invisibly, headers changing with no screen able to show the pattern
responsible. `lib/bridge/port.ts` rejects such a payload outright, with the error code
`unsupported`, until a regex editor exists to go with it (issue #33).

## Turning it on

Three steps.

1. Press **Enable** on the popup's bridge row — it reads **Bridge off** until then. This
   asks Chrome for the `nativeMessaging` permission through its own consent dialog.
2. Run the installer, copying the id from `chrome://extensions`:

   ```bash
   headerlab bridge install --extension-id <id>
   ```

3. The popup now reads **Bridge live**.

`--extension-id` is the instruction the CLI's own README leads with too, because it is the
one that always applies — someone who installed the CLI from npm has no extension
directory to point at.

`--load-path <dir>` is the alternative when you are working on a local unpacked build and
the path is already at hand (`.output/chrome-mv3` for a production build,
`.output/chrome-mv3-dev` under `pnpm dev`). It computes the id from that path rather than
being told it, which is a footgun as much as a convenience: a symlink, a trailing slash, or
a differently spelled path to the same directory each hash to a different id, and a
mismatched manifest installs cleanly and simply never connects.

Either way the installer reports back exactly which id it used, because nothing inside the
CLI can check that against what Chrome actually loaded. Comparing the echoed id against
`chrome://extensions` is the only check there is —
[`tests/e2e/bridge.spec.ts`](../tests/e2e/bridge.spec.ts) does exactly that against a
running browser.

## When it stops working after an upgrade

`bridge install` writes a launcher naming this package's host entry by absolute path.
Anything that moves or removes the installed copy invalidates it — `npm uninstall -g
headerlab`, `npm i -g headerlab@next`, or an nvm switch that relocates the global prefix.
Chrome reports the resulting failure the same way it reports every other native-messaging
problem, so nothing will tell you which one it was except:

```bash
headerlab bridge status
```

It reports `entryMissing` when the launcher points at a file that is no longer there.
Re-running `headerlab bridge install` fixes it.

## What is not built

The command surface is smaller than this design's own §2/§3 — `headerlab status`,
`diagnostics`, `state get`, `rule ls`, and the snapshot-taken-before-every-raw-write do not
exist. Tracked in issue #35.
