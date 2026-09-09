import { z } from 'zod';
import type { AppState, ResourceType } from '@/lib/model/types';

const resourceType = z.enum([
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
]);

/**
 * The fifteen values, in schema order, for anyone who needs the list rather
 * than the validator — `lib/compile/capabilities.ts` derives each target's
 * supported set from it, so a sixteenth type added here reaches that table
 * without a second list to update.
 */
export const RESOURCE_TYPES: readonly ResourceType[] = resourceType.options;

const requestMethod = z.enum([
  'connect',
  'delete',
  'get',
  'head',
  'options',
  'patch',
  'post',
  'put',
  'other',
]);

const headerRuleSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
  target: z.enum(['request', 'response']),
  operation: z.enum(['set', 'append', 'remove']),
  name: z.string(),
  value: z.string(),
  comment: z.string().optional(),
});

const filterSchema = z.object({
  mode: z.enum(['structured', 'regex']),
  // Required, with no default. A default would let a v1 value slip through
  // unmigrated and be silently reinterpreted — which is the whole hazard
  // lib/model/migrate.ts exists to handle, reintroduced one layer down and out
  // of sight. Missing here means "this build cannot read these bytes", which
  // the popup says out loud.
  allSites: z.boolean(),
  domains: z.array(z.string()),
  excludedDomains: z.array(z.string()),
  pathPattern: z.string().optional(),
  regex: z.string().optional(),
  // DNR rejects an empty resourceTypes array outright.
  resourceTypes: z.array(resourceType).min(1),
  requestMethods: z.array(requestMethod).optional(),
});

const profileSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  color: z.enum(['green', 'amber', 'red', 'blue', 'violet', 'cyan']),
  enabled: z.boolean(),
  order: z.number().int().nonnegative(),
  filter: filterSchema,
  tabLock: z.object({
    enabled: z.boolean(),
    tabId: z.number().int().nullable(),
    tabTitle: z.string().nullable(),
  }),
  headers: z.array(headerRuleSchema),
});

export const appStateSchema = z.object({
  version: z.number().int().positive(),
  profiles: z.array(profileSchema),
  globalPause: z.boolean(),
  theme: z.enum(['system', 'light', 'dark']),
});

/** Throws on invalid input. Used at every trust boundary, including JSON import. */
export function parseAppState(input: unknown): AppState {
  return appStateSchema.parse(input) as AppState;
}
