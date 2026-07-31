import type { HeaderRule, ModifyHeaderInfo } from '@/lib/model/types';

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
    // A blank name would produce a rule Chrome's validator rejects, and updates are
    // transactional — one blank row would stop every other rule from applying. The UI
    // creates exactly this state: a new header row starts with an empty name and is
    // persisted before the user types. Full RFC-token validation is Phase 2; declining
    // to emit an unusable rule is this layer's job now.
    if (rule.name.trim() === '') continue;
    const target = rule.target === 'request' ? requestHeaders : responseHeaders;
    target.push(toModifyHeaderInfo(rule));
  }

  const out: ReturnType<typeof compileHeaders> = {};
  if (requestHeaders.length > 0) out.requestHeaders = requestHeaders;
  if (responseHeaders.length > 0) out.responseHeaders = responseHeaders;
  return out;
}
