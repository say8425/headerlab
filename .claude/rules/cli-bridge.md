---
paths:
  - "packages/**"
  - "lib/bridge/**"
  - "tests/e2e/bridge*.ts"
---

# CLI and agent bridge

- **Review `packages/plugin/skills/headerlab/SKILL.md` with every change under
  `packages/headerlab/`.** It is the only reference an agent reads before driving the CLI, so
  being wrong there is invisible — a human reads `--help`, an agent reads the skill. Check its
  claims against the files that decide them: `lib/commands.mjs` (what exists), `lib/exit.mjs`
  (the contract and exit codes), `bin/headerlab.mjs` (what the CLI refuses itself —
  `invalid-args`, exit 2), and `lib/bridge/port.ts` with `lib/bridge/apply.ts` (what the
  extension refuses — exit 1). Filing a code under the wrong layer is the drift the guards
  missed last time.
- **One published package, and that is structural.** `bridge install` writes a launcher naming
  the native-messaging host's entry file by absolute path (`lib/manifest.mjs`'s
  `launcherScript`). A CLI shipped without its host would still write it, and Chrome would
  report the failure exactly like a rejected manifest or a mismatched extension id. Shipping
  both from one tarball makes that impossible. Check the tarball with `npm pack --dry-run`; npm
  always adds `package.json`, `README.md` and `LICENSE` whatever `files` says.
- Zero runtime dependencies; tests are `node:test` (`pnpm test:packages`).
- **Only `socketDir()` (`lib/socket.mjs`) resolves the socket directory.** The host inherits
  Chrome's environment and the CLI the terminal's; resolving `HEADERLAB_SOCKET_DIR` or `$TMPDIR`
  anywhere else lets the two halves silently disagree. Its darwin branch runs
  `/usr/bin/getconf DARWIN_USER_TEMP_DIR` for the same reason.
- The host is a dumb relay (`lib/bridge.mjs` argues why), so the extension cannot see socket
  clients: bridge `idle` means "permission held, no port open" — usually the switch on and
  `headerlab bridge install` never run.
- The launcher at `~/.headerlab/bin/headerlab-host` execs whichever installed copy of this
  package wrote it. Moving or deleting that copy, `npm uninstall -g`, an upgrade or an nvm
  prefix change orphans it, and nothing in Chrome says so; `headerlab bridge status` is the only
  thing that reports `entryMissing`.
- **`state set` cannot be undone from the CLI.** It passes zod validation and nothing else;
  snapshots, `state restore` and `headerlab diagnostics` were decided against (#35,
  2026-08-22). A payload failing validation is refused whole (`invalid-state`), and `--force`
  is required off a terminal. The only backup is
  `headerlab state get --json | jq .state > backup.json`.
- **`status()` cannot see grants.** It builds its payload synchronously and never probes, so
  `tally.live` can count rules for a host the extension has no permission for. The popup is the
  truthful surface until the payload builder is made async.
- Firefox has no bridge: its event pages close native ports on idle, so the Firefox manifest
  declares no `optional_permissions` and the popup renders no bridge row.
