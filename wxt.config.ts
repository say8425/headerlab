import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ mode }) => ({
    name: 'HeaderLab',
    // The Chrome Web Store reads the item's title and its summary out of this
    // manifest — neither is a dashboard field — and the dashboard offers a
    // listing translation only for a locale the package declares under
    // `_locales/`. So a store listing in five languages is this line plus
    // `public/_locales/`, not a documentation task.
    //
    // `name` deliberately stays a literal: it is the same nine characters in
    // every locale, and a `__MSG_` name would buy nothing while adding a key
    // whose absence from any one locale file fails the whole extension to
    // load. `description` is the half that genuinely differs.
    //
    // The message files live under `public/` because that directory is copied
    // to the output root, so every mode — e2e and bridge-e2e included — ships
    // them. A `__MSG_` reference with no `_locales` beside it is not a
    // fallback: Chrome refuses to load the extension at all.
    default_locale: 'en',
    description: '__MSG_extDescription__',
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
