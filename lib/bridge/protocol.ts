import { z } from 'zod';
import type { AppState } from '@/lib/model/types';

/**
 * The shape of commands the bridge accepts.
 *
 * Read commands (`state get`, `status`, `diagnostics`) are not here. They
 * don't change state, so they can call `compile()` and `ruleTally()`
 * directly — there is no reason to route them through the reducer. This
 * schema is the list of **writes**.
 *
 * Why the discriminant is `cmd` on a discriminated union: an unknown command
 * has to fail as "no such cmd" rather than "a union where no field matches",
 * so the CLI can hand a human something readable back.
 */
export const commandSchema = z.discriminatedUnion('cmd', [
  z.object({ cmd: z.literal('site.add'), domains: z.array(z.string().min(1)).min(1) }),
  z.object({ cmd: z.literal('site.remove'), domains: z.array(z.string().min(1)).min(1) }),
  z.object({ cmd: z.literal('site.allSites'), on: z.boolean() }),
  z.object({
    cmd: z.literal('rule.add'),
    target: z.enum(['request', 'response']),
    operation: z.enum(['set', 'append', 'remove']),
    // The missing `.min(1)` is deliberate — it looks inconsistent next to
    // `id`, `domains` and the other fields, but a rule being born nameless is
    // normal in this repo (`newRule` in defaults.ts). That is why
    // `incomplete-header` exists as a diagnostic separate from
    // `invalid-header-name`, and this schema must not reject the blank rule
    // the popup creates every time.
    name: z.string(),
    // `remove` carries no value (types.ts). Allow it to be omitted but
    // normalize to an empty string, so the stored shape is always one shape.
    value: z.string().default(''),
  }),
  z.object({ cmd: z.literal('rule.remove'), id: z.string().min(1) }),
  // Omitting `on` means "flip it". Requiring it would force the CLI to read
  // before every toggle.
  z.object({ cmd: z.literal('rule.toggle'), id: z.string().min(1), on: z.boolean().optional() }),
  z.object({ cmd: z.literal('pause') }),
  z.object({ cmd: z.literal('resume') }),
  // The payload is deliberately not checked here. Filtering it through
  // `appStateSchema` is apply()'s job, so a bad payload comes back as a
  // structured `invalid-state` rather than a parse throw — the person who
  // typed it is three processes away.
  z.object({ cmd: z.literal('state.set'), state: z.unknown() }),
]);

export type Command = z.infer<typeof commandSchema>;

/** Throws on failure. Call this at the trust boundary. */
export function parseCommand(input: unknown): Command {
  return commandSchema.parse(input);
}

export type ApplyErrorCode =
  | 'invalid-command'
  | 'invalid-state'
  | 'unknown-rule'
  | 'unknown-domain';

export interface ApplyError {
  code: ApplyErrorCode;
  message: string;
}

/**
 * `changed` is a different fact from `ok`.
 *
 * Adding a site that is already there is not a failure — the requested state
 * is already true. But the fact that nothing happened still has to be said.
 * This is the same distinction the popup's AddSiteField makes by returning
 * `{added: false, alreadyThere}`, and it has to be the same distinction.
 */
export type ApplyResult =
  | { ok: true; state: AppState; changed: boolean; note?: string }
  | { ok: false; error: ApplyError };
