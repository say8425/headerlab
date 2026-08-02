import type { HeaderRule, ModifyHeaderInfo } from '@/lib/model/types';

// Chrome only registers a header name that is a valid RFC 7230 token — no
// leading/trailing/inner whitespace, no colon, ASCII only — and rejects the
// whole updateDynamicRules batch otherwise, taking every other rule down
// with it. This is the exact boundary a real Chrome probe found: whitespace
// (any position), a colon, and non-ASCII are all rejected; a clean token is
// accepted.
//
// Exported so lib/compile/validate.ts can use the identical boundary. Two
// copies of this regex would drift silently — a row could then be dropped
// here with no diagnostic there, or flagged there while still emitted here.
export const HEADER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function toModifyHeaderInfo(rule: HeaderRule): ModifyHeaderInfo {
  // `value` must be absent for remove and present for set/append.
  if (rule.operation === 'remove') {
    return { header: rule.name, operation: 'remove' };
  }
  return { header: rule.name, operation: rule.operation, value: rule.value };
}

export function compileHeaders(headers: HeaderRule[]): {
  requestHeaders?: ModifyHeaderInfo[];
  responseHeaders?: ModifyHeaderInfo[];
} {
  const requestHeaders: ModifyHeaderInfo[] = [];
  const responseHeaders: ModifyHeaderInfo[] = [];

  for (const rule of headers) {
    if (!rule.enabled) continue;
    // The UI persists whatever the user typed or pasted on every keystroke, and a
    // new header row starts with an empty name before the user types — so a
    // trailing space from a copied curl command, or a blank/invalid name, reaches
    // here routinely. Trim first and validate the result: "X-Test " is rescued as
    // "X-Test" rather than dropped, while a name that is still not a valid token
    // after trimming (inner whitespace, a colon, non-ASCII, or blank) is skipped.
    // Full RFC-token diagnostics are Phase 2; declining to emit an unusable rule
    // is this layer's job now.
    const name = rule.name.trim();
    if (!HEADER_TOKEN.test(name)) continue;
    const target = rule.target === 'request' ? requestHeaders : responseHeaders;
    target.push(toModifyHeaderInfo({ ...rule, name }));
  }

  const out: ReturnType<typeof compileHeaders> = {};
  if (requestHeaders.length > 0) out.requestHeaders = requestHeaders;
  if (responseHeaders.length > 0) out.responseHeaders = responseHeaders;
  return out;
}
