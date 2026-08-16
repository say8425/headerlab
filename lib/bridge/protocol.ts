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
  | 'unknown-domain'
  // The stored bytes failed validation. Distinct from `invalid-state`, which
  // is about the payload the caller sent: this one says the caller's command
  // was fine and there is nothing safe to apply it to. Applying onto the
  // fallback and writing the result would overwrite whatever was really on
  // disk — the defect App.tsx already paid for once (`if (!valid) return`).
  | 'store-unreadable'
  // The read or the write itself threw — a chrome.storage.local operation
  // failing (quota, or the extension torn down mid-write), not the bytes
  // failing validation. Distinct from `store-unreadable`, which means the
  // read succeeded and the *content* was unusable; this one means the
  // storage call never completed at all. Without this code, either failure
  // was invisible: handleMessage's reply() was never reached and the CLI saw
  // only `timeout` ten seconds later, pointing at the transport for a cause
  // that was storage (lib/bridge/port.ts).
  | 'store-unwritable'
  // Refused rather than failed. `state.set` can carry `filter.mode: 'regex'`,
  // which `appStateSchema` accepts and `filterToCondition` compiles straight
  // into `regexFilter` with nothing having asked
  // `chrome.declarativeNetRequest.isRegexSupported()`. The popup has no regex
  // editor, so a payload that sets one produces a rule nobody can see or fix.
  // Design §3.1 puts this refusal at the adapter, not in the pure layer.
  | 'unsupported';

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

/**
 * 읽기. `commandSchema` 가 쓰기 목록인 것과 짝을 이룬다.
 *
 * 모양이 하나뿐인 것은 의도다. `headerlab status`·`rule ls`·`site ls`·
 * `state get` 넷이 전부 이 하나를 먹고 CLI 쪽에서 다르게 그린다. 읽기
 * 명령이 더 붙어도 렌더만 늘고 프로토콜은 그대로다.
 *
 * 리듀서(`apply()`)를 거치지 않는다 — 상태를 바꾸지 않으므로 `compile()`
 * 과 `ruleTally()` 를 직접 부르면 되고, 그것이 `lib/bridge/query.ts` 다.
 */
export const querySchema = z.discriminatedUnion('cmd', [z.object({ cmd: z.literal('status') })]);

export type Query = z.infer<typeof querySchema>;

/** Throws on failure. Call this at the trust boundary. */
export function parseQuery(input: unknown): Query {
  return querySchema.parse(input);
}
