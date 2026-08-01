import type { DnrRuleCondition, Filter } from '@/lib/model/types';
import { isValidDomain, normalizeDomain } from '@/lib/permissions/origins';

/**
 * Builds the urlFilter fragment for a path pattern.
 *
 * urlFilter matches a substring of the whole serialized URL, so a bare "/v2/"
 * also matches "?q=/v2/". With exactly one target domain we can anchor against
 * it: "||" is the domain-name anchor and "^" the separator character. With
 * several domains a single anchored pattern cannot cover them all, so the
 * fragment is left unanchored and the UI shows a match preview instead.
 */
function buildUrlFilter(pathPattern: string, domains: string[]): string | undefined {
  let path = pathPattern.trim();
  if (!path) return undefined;

  // urlFilter is an unanchored substring match, so a trailing "*" adds nothing.
  while (path.endsWith('*')) path = path.slice(0, -1);
  if (!path) return undefined;

  if (!path.startsWith('/')) path = `/${path}`;

  return domains.length === 1 ? `||${domains[0]}^*${path}` : path;
}

export function filterToCondition(
  filter: Filter,
  tabId?: number | null,
): DnrRuleCondition {
  // Normalized once here so requestDomains and the urlFilter anchor agree with
  // each other and with the permission audit in lib/permissions/origins.ts —
  // "API.Example.com" and "api.example.com" must compile to the same
  // condition. Validity (an invalid domain must suppress the whole profile's
  // rule, not just be dropped here) is decided by the caller — see
  // lib/compile/compile.ts — because dropping just the bad domain would
  // leave a rule with no domain condition, which DNR matches against every
  // site.
  const domains = filter.domains.map(normalizeDomain);

  const condition: DnrRuleCondition = {
    resourceTypes: [...filter.resourceTypes],
  };

  if (domains.length > 0) {
    condition.requestDomains = domains;
  }
  // Exclusions get the same normalization the include side gets, so the same
  // user string means the same host on both. Dropping an unusable exclusion
  // individually is safe — one fewer exclusion can only narrow the rule back
  // toward what the domain list already says. The include side is NOT safe
  // this way: dropping every domain leaves a rule with no domain condition,
  // which DNR matches against every site.
  const excluded = [
    ...new Set(filter.excludedDomains.filter(isValidDomain).map(normalizeDomain)),
  ];
  if (excluded.length > 0) {
    condition.excludedRequestDomains = excluded;
  }

  // urlFilter and regexFilter are mutually exclusive.
  if (filter.mode === 'regex') {
    const regex = filter.regex?.trim();
    if (regex) condition.regexFilter = regex;
  } else if (filter.pathPattern) {
    const urlFilter = buildUrlFilter(filter.pathPattern, domains);
    if (urlFilter) condition.urlFilter = urlFilter;
  }

  if (filter.requestMethods && filter.requestMethods.length > 0) {
    condition.requestMethods = [...filter.requestMethods];
  }

  if (typeof tabId === 'number') {
    condition.tabIds = [tabId];
  }

  return condition;
}
