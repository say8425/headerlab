/**
 * Sets the theme class at parse time, before the module script and before
 * first paint.
 *
 * Not inline: MV3's extension CSP is `script-src 'self'` and forbids
 * `unsafe-inline`, so an inline script never runs — it only logs a violation.
 * A packaged file satisfies 'self'. Measured against a real loaded extension.
 *
 * Not a module: `type="module"` defers, which is exactly the paint we are
 * trying to get ahead of.
 *
 * Phase 2b follows the OS only. When Phase 2c adds the toggle it reads the
 * stored theme and swaps this class — a class beats the media query, so
 * swapping is all it takes.
 */
(function () {
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.classList.add('dark');
  }
})();
