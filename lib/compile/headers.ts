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
    const target = rule.target === 'request' ? requestHeaders : responseHeaders;
    target.push(toModifyHeaderInfo(rule));
  }

  const out: ReturnType<typeof compileHeaders> = {};
  if (requestHeaders.length > 0) out.requestHeaders = requestHeaders;
  if (responseHeaders.length > 0) out.responseHeaders = responseHeaders;
  return out;
}
