---
name: headerlab
description: Read and change HeaderLab's HTTP header rules from the command line — scope which sites a rule applies to, add/remove/toggle header rules, pause or resume the whole rule set, or replace stored state wholesale. Use whenever the user asks to add or edit a header rule, scope a rule to a site, pause/resume HeaderLab, or inspect its current rules.
---

# HeaderLab CLI

!`command -v headerlab || echo MISSING-CLI`

If the line above reads `MISSING-CLI`, the `headerlab` binary is not on this
PATH. Say so plainly and stop — do not guess at a substitute command, and do
not assume the extension is reachable some other way. That line is a fact
gathered before this skill's content ever reached you, not a prompt asking
you to notice a problem yourself; treat it with the same weight.

## What this is

`headerlab` is a CLI that talks to a running instance of the [HeaderLab
Chrome extension](https://github.com/say8425/headerlab) over a native-messaging
bridge. The extension modifies HTTP request and response headers per site,
under a Grant-based permission model — nothing it does is invisible to the
person running Chrome, and this CLI does not change that.

**Output is always one JSON object on stdout, success or failure, with the
exit code following it** — `0` on success, `1` otherwise. There is no human
prose to parse and none to produce; if you need to explain something to the
person you're working with, say it yourself, not by relaying raw JSON.

## `bridge-off` is a state, not a retry loop

Every command can fail with `{"ok":false,"error":{"code":"bridge-off",...}}`.
That means no HeaderLab bridge is currently running — not that this attempt
was unlucky. The host cannot be started from outside; there is nothing to
wait for. Report it as "the bridge is not running" and stop, the same way
you would report `MISSING-CLI` above. If more than one bridge is running,
the error code is `multiple-bridges` instead, and its message lists each
candidate's pid — rerun with `--bridge <pid>` naming one of them.

The most common reason no bridge is running is that the native messaging
host manifest was never installed — `headerlab bridge install` writes that
manifest. But installing it is not the same as turning the bridge on: **it
only has an effect after a person opens the HeaderLab popup and clicks
Enable on the bridge row.** The CLI can write the manifest; it cannot grant
the permission or flip the switch, the same way `site add` cannot click
Grant (see below). Run `headerlab bridge status` first to see what is
already installed and what is live before assuming an install is needed at
all.

## Commands

All of these are subcommands of `headerlab`. A global `--bridge <pid>` flag
may be inserted anywhere in argv to pick a specific bridge when more than
one is live; omit it when only one is running.

| Command | Effect |
|---|---|
| `headerlab site add <domain...>` | Scope the active rule to one or more domains, in addition to whatever it already covers. |
| `headerlab site rm <domain...>` | Remove one or more domains from the active rule's scope. |
| `headerlab site all-sites on\|off` | Turn the "applies everywhere" mode on or off. **This never grants a permission** — see below. |
| `headerlab rule add --target request\|response --op set\|append\|remove --name <header> --value <value>` | Add one header rule. `--name`/`--value` may be omitted (they default to `''`); a nameless rule is a normal, unfinished state in HeaderLab, not an error. |
| `headerlab rule rm <id>` | Remove a rule by id. |
| `headerlab rule toggle <id> [--on\|--off]` | Turn a rule on or off. Omit both flags to flip whatever it currently is. |
| `headerlab pause` | Pause header modification entirely, without touching any rule's own on/off state. |
| `headerlab resume` | Resume after a pause. |
| `headerlab state set <file\|->` | Replace the extension's entire stored state with the JSON at `<file>`, or from stdin when the argument is `-`. This is a full overwrite, not a merge — read the current state back from a prior reply before doing this if anything in it needs to survive. |
| `headerlab bridge install --extension-id <id>\|--load-path <dir> [--user-data-dir <dir>] [--browser chrome\|chromium]` | Install the native messaging host manifest that makes a bridge possible. Never touches a socket — see below. |
| `headerlab bridge uninstall [--user-data-dir <dir>] [--browser chrome\|chromium]` | Remove the manifest this installed. Idempotent: removing what is not there is success. |
| `headerlab bridge status [--user-data-dir <dir>] [--browser chrome\|chromium]` | Report what is installed and what is live, without requiring a bridge to be running. |

`--user-data-dir`/`--browser` pick *where* `uninstall`/`status` look, and they
must match whatever `install` was given — the manifest lives wherever
`install` wrote it, not at a fixed default. This is a real trap: `status`
after `bridge install --browser chromium` will answer `installed: false` if
asked without `--browser chromium`, because it looked at Chrome's default
location, not Chromium's. That is a wrong answer about the wrong place, not
evidence nothing is installed — if `install` was given either flag, pass the
same value to every later `uninstall`/`status` call. `status`'s reply always
names the exact `manifestPath`/`launcherPath` it looked at, so when in doubt,
compare that path against what `--user-data-dir`/`--browser` should have
produced rather than trusting `installed: false` alone.

There is currently no dedicated read-only command. Every **successful**
write's reply carries the resulting state in full (`{"ok":true,"state":
{...}, "changed": <bool>, "note"?: "..."}`), so the way to see current rules
from this CLI is to read that field off the reply of whatever write you just
issued — there is nothing that reads state without also being a write.

## Adding a site does not grant permission

`site add` and `site all-sites on` both change what a rule is *scoped* to.
Neither one requests the Chrome permission that access to a site actually
requires — HeaderLab's design keeps that as a separate, human-only step: a
person has to click **Grant** on the row for that site inside the popup.
A site or an all-sites mode can sit in the "pending" state indefinitely if
nobody has clicked Grant, and that is expected, not a bug in this CLI. If
you add a site on someone's behalf, tell them a permission grant is still
outstanding — do not imply the site is already active.

## Error codes

Besides `ok:false` with a message, `error.code` is one of: `usage` (nothing
or malformed global flags), `unknown-command`, `invalid-args` (a known
command with a bad shape), `invalid-command` (a `state set` source that
could not be read, was too large, or was not valid JSON), `bridge-off`,
`multiple-bridges`, `timeout` (the bridge accepted the connection but never
replied), `bridge-error`/`bridge-closed` for other transport failures, and
three more:

- `store-unreadable` — the extension's stored state does not match the
  format this version expects, so nothing was applied and nothing was
  overwritten. Can come back from any write, not just `bridge install`. Tell
  the person to open the popup and check it themselves, then stop — this is
  not something to retry or work around.
- `unsupported` — this build refuses the request outright (currently: a
  `state set` payload with a regex filter — there is no regex editor in the
  popup and nothing validates the pattern). Do not look for a workaround;
  report it as a hard no.
- `install-failed` — `bridge install` specifically: the manifest was written
  but failed its own verification and was rolled back, so nothing was left
  behind. Relay the message as given; it already says what Chrome would have
  said.

None of these are worth retrying automatically — each names a specific,
stable condition to report as-is.
