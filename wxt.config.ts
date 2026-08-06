import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ mode }) => ({
    name: 'HeaderLab',
    description: 'Add, modify and remove HTTP request and response headers.',
    permissions: ['storage', 'declarativeNetRequestWithHostAccess'],
    optional_host_permissions: ['<all_urls>'],
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
    // Task 14 Step 3 asserts this never reaches a production build.
    ...(mode === 'e2e' ? { host_permissions: ['http://127.0.0.1/*'] } : {}),
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
