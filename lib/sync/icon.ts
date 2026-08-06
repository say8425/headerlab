import { browser } from 'wxt/browser';

/**
 * The two icon sets, by run state.
 *
 * Two static sets rather than desaturating one at runtime. `OffscreenCanvas`
 * in the worker could produce the grey from the colour and save eight files,
 * but it would put image decoding and pixel work on the service worker's
 * startup path — which runs on every wake, for a result the user cannot tell
 * apart from a second PNG. The greyscale also is not a mechanical desaturation
 * of the green: that lands on a dark grey which disappears into Chrome's dark
 * toolbar, so the paused fill was chosen to stay legible on both themes
 * (scripts/make-icons.mjs).
 *
 * Only 16 and 32 — the toolbar draws those two, at 1x and 2x. The 48 and 128
 * in `icons` are for the extensions page and the store, and `setIcon` never
 * needs them.
 */
export const ICON_PATHS = {
  active: { 16: '/icon/active-16.png', 32: '/icon/active-32.png' },
  paused: { 16: '/icon/paused-16.png', 32: '/icon/paused-32.png' },
} as const;

/**
 * The only module permitted to call chrome.action.setIcon — the same shape as
 * ruleSync's rule for declarativeNetRequest, and for the same reason: one
 * place where a browser call meets the rest of the code.
 *
 * Takes the state rather than reading it, so nothing here has to agree with
 * storage; the caller has already compiled from the state it is applying.
 */
export async function setToolbarIcon(paused: boolean): Promise<void> {
  await browser.action.setIcon({ path: { ...ICON_PATHS[paused ? 'paused' : 'active'] } });
}
