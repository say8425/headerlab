/**
 * The id the Firefox manifest declares (`browser_specific_settings.gecko.id`).
 * Spelled once here and once in wxt.config.ts; tests/unit/manifest.test.ts
 * binds the two. Email-shaped as MDN recommends — not a mailbox, a namespace.
 */
export const GECKO_ID = 'headerlab@say8425.github.io';

/**
 * The internal UUID the e2e profile pins for that id
 * (`extensions.webextensions.uuids`), so `moz-extension://<uuid>/popup.html`
 * is a known address. Firefox otherwise mints one per profile.
 */
export const EXTENSION_UUID = '5f0c2f3e-1111-4222-8333-444455556666';
