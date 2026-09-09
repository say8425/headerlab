import { RESOURCE_TYPES } from '@/lib/model/schema';
import type { HeaderTarget, ResourceType, Target } from '@/lib/model/types';

/**
 * What each browser's declarativeNetRequest accepts, in one place.
 *
 * "One predicate, one definition" (CLAUDE.md), applied to the browser: every
 * difference between targets that the compiler, the diagnostics or the popup
 * has to know about is a row here, never an `if (target === 'firefox')`
 * somewhere else. Pure — `lib/compile/` is auto-guarded by
 * tests/unit/purity.test.ts — and the target arrives as a parameter, never
 * from `lib/target.ts`.
 *
 * Every row is measured, not read off a compatibility table:
 * docs/research/2026-09-08-firefox-marionette-spike.md.
 */

/**
 * Types Firefox's DNR schema does not know. `updateDynamicRules` answers a
 * rule carrying one with `Invalid enumeration value "webbundle"` and rejects
 * the **whole batch** — every other rule with it. BCD records both as
 * `version_added: false`.
 */
const FIREFOX_UNSUPPORTED_RESOURCE_TYPES: ReadonlySet<ResourceType> = new Set([
  'webtransport',
  'webbundle',
]);

export const SUPPORTED_RESOURCE_TYPES: Readonly<Record<Target, ReadonlySet<ResourceType>>> = {
  chrome: new Set(RESOURCE_TYPES),
  firefox: new Set(RESOURCE_TYPES.filter((t) => !FIREFOX_UNSUPPORTED_RESOURCE_TYPES.has(t))),
};

/** `types` less what `target` cannot take, in the order given. */
export function supportedResourceTypes(
  target: Target,
  types: readonly ResourceType[],
): ResourceType[] {
  const supported = SUPPORTED_RESOURCE_TYPES[target];
  return types.filter((t) => supported.has(t));
}

/** The complement of {@link supportedResourceTypes}, for the diagnostic that names them. */
export function unsupportedResourceTypes(
  target: Target,
  types: readonly ResourceType[],
): ResourceType[] {
  const supported = SUPPORTED_RESOURCE_TYPES[target];
  return types.filter((t) => !supported.has(t));
}

/**
 * Chromium's `kDNRRequestHeaderAppendAllowList`. Exactly these 21 request
 * headers accept `append`.
 *
 * Anything else fails at rule-registration time with
 * ERROR_APPEND_INVALID_REQUEST_HEADER, and `updateDynamicRules` is
 * transactional — so one bad row stops every already-working rule. That error
 * never reaches the user, which is why this has to be caught here.
 *
 * Response headers have no allowlist at all: any header may be appended, and
 * the semantics differ (a request append joins with a separator, a response
 * append adds another header line).
 */
export const APPEND_ALLOWED_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'access-control-request-headers',
  'cache-control',
  'connection',
  'content-language',
  'cookie',
  'forwarded',
  'if-match',
  'if-none-match',
  'keep-alive',
  'range',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
  'via',
  'want-digest',
  'x-forwarded-for',
]);

/**
 * Whether `append` is accepted for this header on this target.
 *
 * Chrome: response headers always, request headers only from the allowlist
 * above — outside it, `updateDynamicRules` fails the whole batch with
 * ERROR_APPEND_INVALID_REQUEST_HEADER. Firefox: any header, either
 * direction — measured 2026-09-08, `X-Custom` appended to a request was
 * accepted. The name is compared trimmed and lower-cased because header
 * names are case-insensitive and the popup persists what was typed.
 */
export function isAppendAllowed(target: Target, headerTarget: HeaderTarget, name: string): boolean {
  if (headerTarget === 'response') return true;
  if (target === 'firefox') return true;
  return APPEND_ALLOWED_REQUEST_HEADERS.has(name.trim().toLowerCase());
}

/**
 * Whether the agent bridge can exist on this target.
 *
 * Firefox MV3 backgrounds are event pages, and "message ports cannot prevent
 * an event page from shutting down … the ports are closed when the event page
 * idles" (MDN). The native host dies with the port, so the bridge as designed
 * — a host that stays up holding a socket — cannot run there. Spec §9; the
 * Firefox bridge is its own spec. The popup renders no bridge row where this
 * is false, and the Firefox manifest declares no `nativeMessaging`.
 */
export function hasBridge(target: Target): boolean {
  return target === 'chrome';
}

/** How copy spells each browser. */
export const BROWSER_NAME: Readonly<Record<Target, string>> = {
  chrome: 'Chrome',
  firefox: 'Firefox',
};
