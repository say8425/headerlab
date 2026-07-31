import type { DnrRuleCondition, Filter } from '@/lib/model/types';

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
  const condition: DnrRuleCondition = {
    resourceTypes: [...filter.resourceTypes],
  };

  if (filter.domains.length > 0) {
    condition.requestDomains = [...filter.domains];
  }
  if (filter.excludedDomains.length > 0) {
    condition.excludedRequestDomains = [...filter.excludedDomains];
  }

  // urlFilter and regexFilter are mutually exclusive.
  if (filter.mode === 'regex') {
    const regex = filter.regex?.trim();
    if (regex) condition.regexFilter = regex;
  } else if (filter.pathPattern) {
    const urlFilter = buildUrlFilter(filter.pathPattern, filter.domains);
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
