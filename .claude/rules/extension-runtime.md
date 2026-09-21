---
paths:
  - "lib/**"
  - "entrypoints/background.ts"
  - "entrypoints/popup/{App,main}.tsx"
  - "entrypoints/popup/index.html"
  - "public/**"
  - "wxt.config.ts"
  - "tests/unit/{manifest,bundle,purity,migrate,apply,conflicts}.test.ts"
  - "tests/e2e/*fixtures.ts"
---

# Extension runtime

## Platform traps

Each of these was found the expensive way. Do not re-derive them.

- **MV3 blocks inline scripts.** Extension pages run under `script-src 'self'`, so an inline
  `<script>` in `entrypoints/popup/index.html` silently never runs. The theme bootstrap is
  `public/theme.js`, a classic script — a module would defer past first paint and flash.
- **`updateDynamicRules` is transactional**: one malformed entry rejects the whole batch, not
  its own rule. `lib/compile/validate.ts` exists because of this. Known triggers: a header name
  violating RFC 7230, and on Chrome `append` on a request header outside its 21-header
  allowlist (Firefox accepts `append` on any request header — `capabilities.ts` is the one
  table of what each target accepts).
- **`permissions.contains()` throws on a malformed match pattern** on Chrome (Firefox returns
  `false`), and a throw loses the answer for every other origin in the same call.
  `lib/permissions/probe.ts` probes one origin per call, each caught.
- **The permission ladder has six rungs, not four**, on both browsers. `contains()` is a subset
  check: `*://` demands both schemes, and an `http://`-only grant matches none of the `https` or
  `*://` rungs. Without the `http` rungs `localhost` shows a false "needs permission"
  (`docs/research/2026-08-01-permission-audit-spike.md`).
- **DNR's `requestDomains` is host-only** and silently accepts ports, schemes and paths,
  producing a rule that never matches. **Normalize, don't reject**: `analyzeDomain` strips a
  leading `*.`/`.` and a trailing `.` (each to a fixed point) and one trailing port —
  deliberately not looped, or `example.com:80:90` becomes a plausible host. `effectiveDomain`
  runs at write time so the stored value is the value that operates.
- **WXT**: storage via `#imports`, not `wxt/storage`; keys carry an area prefix (`local:`,
  `session:`); `public/` is copied to the output root; output directories are mode-suffixed
  (`--mode e2e` → `chrome-mv3-e2e`). There are three e2e builds: Chrome `e2e`, Chrome
  `bridge-e2e`, Firefox `e2e`. `bridge-e2e` exists because granting `nativeMessaging` in the
  shared build put every popup test into the bridge's error state (`wxt.config.ts` explains).
- **Migrations run once, at module evaluation — not per read.** A value written to `local:state`
  after `lib/storage/state.ts` was imported is never migrated, so a fixture seeding storage
  seeds the version key too, at the current `STATE_VERSION`: `{ state, state$: { v: 2 } }`.
  Testing a migration needs `vi.resetModules()` before importing fake-browser and `state.ts`
  (`tests/unit/migrate.test.ts`).
- **Firefox** (`docs/research/2026-09-08-firefox-marionette-spike.md`): WXT builds `-b firefox`
  as MV2 unless `manifestVersion: 3` is set; Firefox MV3 has no `background.service_worker`
  (WXT emits `background.scripts`); `updateDynamicRules` rejects `webbundle` and `webtransport`
  resource types — the whole batch — so `conditions.ts` filters by target and
  `suppressionReason` returns `'no-resource-type'` when nothing is left. Event pages close
  native ports on idle, so the bridge cannot run there.
- On empty storage the popup bootstraps a profile by read-then-write, which can clobber a seed
  written concurrently; every Firefox e2e spec seeds through `seedFirefoxState`
  (`tests/e2e/firefox-fixtures.ts`), which waits for that write first.

## Semantics that are easy to get wrong

- What the site list holds and what scopes a rule are different things (all-sites keeps the list
  and compiles none of it): ask `scopingHosts`, never read `filter.domains`.
- `'no-scope'` survives as a `SuppressionReason` (`lib/compile/suppression.ts`) that
  `lib/bridge/query.ts` ships to the CLI. The same-spelled `DiagnosticKind` member was retired
  with its producer; the surviving string is not evidence the diagnostic is back.

## Known gaps

- `stateItem.watch` (`lib/storage/useAppState.ts`) puts values into state without validation.
  Reachable only by an external writer.
- `domainsToAudit` and `auditDiagnostics` skip every suppressed profile — right for `no-scope`,
  but a profile suppressed only by Firefox-unsupported resource types then shows no Grant button
  for a missing permission. Reachable only through a hand-edited store; fix it with the
  dropped-types note (popup-ui rules).
