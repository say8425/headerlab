import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ mode }) => ({
    name: 'HeaderLab',
    // The Chrome Web Store reads the item's title and its summary out of this
    // manifest — neither is a dashboard field. So both of these lines are
    // shipped values: changing either is a release, not a form edit.
    //
    // **This package declares no locales, deliberately (owner's call,
    // 2026-08-23).** It carried `_locales/{en,ko,ja,zh_CN,es}/` and a
    // `__MSG_extDescription__` here, which made the dashboard report five
    // supported languages — while those five files translated exactly one
    // string between them and the popup called `i18n` nowhere. A person
    // installing in Korean got an entirely English UI. The design documents
    // said "UI language: English" from the first week; it was the directories
    // that drifted away from the prose, and the dashboard reported the
    // directories.
    //
    // With one locale left the indirection has nothing to vary, so it is gone
    // rather than narrowed: `_locales/en` resolving an English string to an
    // English string is a mechanism whose only remaining property is its
    // failure mode. The production-manifest unit suite pins the absence of all
    // three pieces — `_locales`, `default_locale`, `__MSG_` — and they do not
    // fail alike, measured 2026-08-23 by loading each variant in real Chromium:
    // `default_locale` without `_locales` is REFUSED, `_locales` without
    // `default_locale` is REFUSED, and a `__MSG_` reference with neither
    // LOADS — shipping the literal `__MSG_extDescription__` as the store
    // summary. So two of the three are loud and one is
    // silent, which is the one the suite is really for.
    //
    // (Named in prose rather than by path: a quoted path under the test tree
    // in a shipped source is what the build-freshness carve-out guard forbids,
    // and it caught this comment.)
    description:
      'Set, append or remove HTTP request and response headers, per site. ' +
      'No host access until you grant it. No network calls.',
    permissions: ['storage', 'declarativeNetRequestWithHostAccess'],
    optional_host_permissions: ['<all_urls>'],
    // Requested at runtime from the popup's Enable button, never at install.
    // `extensions_api_permissions.cc:113-114` carries no `kFlagCannotBeOptional`
    // for this one (declarativeNetRequest does, at :57-59), and the runtime
    // grant was measured rather than inferred — the consent dialog appeared,
    // allowing it worked, and a second click went straight to connectNative
    // (docs/research/2026-08-11-native-messaging-spike.md).
    optional_permissions: ['nativeMessaging'],
    // Icons need no permission — the manifest declares files, it does not ask
    // for a capability. tests/unit/manifest.test.ts pins the permission list
    // unchanged so that stays true rather than being assumed.
    //
    // 16 is the toolbar and the favicon, 32 its 2x and what Windows reaches
    // for, 48 the extensions page, 128 install and the Web Store.
    icons: {
      16: 'icon/active-16.png',
      32: 'icon/active-32.png',
      48: 'icon/active-48.png',
      128: 'icon/active-128.png',
    },
    action: {
      // The toolbar slot only ever draws 16 at 1x and 32 at 2x; the larger two
      // would just be bytes Chrome downscales. `setIcon` swaps this pair at
      // runtime, and this declaration is what it falls back to — which is
      // exactly why the paused state has to be re-applied on worker startup.
      default_icon: {
        16: 'icon/active-16.png',
        32: 'icon/active-32.png',
      },
    },
    // e2e builds only: lets the E2E suite modify headers on the loopback echo
    // server without a runtime permission prompt Playwright cannot click.
    // tests/unit/manifest.test.ts asserts this never reaches a production build.
    ...(mode === 'e2e' ? { host_permissions: ['http://127.0.0.1/*'] } : {}),
    // bridge-e2e builds only, and deliberately its own mode rather than a third
    // thing bolted onto 'e2e' above. Two things Playwright cannot do: click
    // Chrome's consent dialog for a runtime permission, and click the popup's
    // Enable button before the worker has started — so this build grants
    // nativeMessaging at install, the same bargain the loopback host permission
    // above already makes for the header-modification suite.
    //
    // A single shared e2e manifest granting this outright was tried first and
    // reverted: `probeNativeMessaging()` reads the permission itself, so every
    // popup in the plain e2e suite — not just the bridge tests — would land on
    // `bridge: 'idle'` with a real connect error the instant nativeMessaging
    // was held but no host manifest existed for that test's throwaway profile.
    // That mounts ScopeRail.tsx's `bridge-error` note, which is not part of the
    // rail's already-zero-slack layout budget (see the `site-list` docblock
    // there) — measured against the built popup, the site list collapsed from
    // its 127px cap to 0, failing two pre-existing layout guards in
    // tests/e2e/header-modification.spec.ts. Keeping the plain 'e2e' manifest
    // exactly as it was before this bridge work — no nativeMessaging in it at
    // all — means every test that does not care about the bridge sees exactly
    // the popup it always has. Only tests/e2e/bridge.spec.ts, via
    // tests/e2e/bridge-fixtures.ts, builds and loads this mode.
    ...(mode === 'bridge-e2e'
      ? { permissions: ['storage', 'declarativeNetRequestWithHostAccess', 'nativeMessaging'] }
      : {}),
  }),
  vite: () => ({
    plugins: [tailwindcss()],
    build: {
      // Vite injects a modulepreload polyfill that calls `fetch()` on any
      // `link[rel="modulepreload"]`. No entrypoint here emits such a link, so
      // the code never runs — but it leaves a literal `fetch(` in the shipped
      // bundle, and this extension's central claim is that it makes no network
      // calls at all. That claim should be checkable by reading the output,
      // without an exception list.
      modulePreload: false,
    },
  }),
});
