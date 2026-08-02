import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ mode }) => ({
    name: 'HeaderLab',
    description: 'Add, modify and remove HTTP request and response headers.',
    permissions: ['storage', 'declarativeNetRequestWithHostAccess'],
    optional_host_permissions: ['<all_urls>'],
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
