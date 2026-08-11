import { bootstrapProfile, newRule } from '@/lib/model/defaults';
import { effectiveDomain, isValidDomain } from '@/lib/permissions/origins';
import { parseAppState } from '@/lib/model/schema';
import { resolveSingleProfile } from '@/lib/view/singleProfile';
import type { ApplyResult, Command } from '@/lib/bridge/protocol';
import type { AppState, Profile } from '@/lib/model/types';

/**
 * Turns one bridge command into a state change. Pure.
 *
 * **Touches only the one rule set this screen shows.** When storage holds
 * more than one, `resolveSingleProfile` picks the first and leaves the rest
 * alone. The truncation is the popup's write (App.tsx); implementing that
 * judgment a second time here is how the two diverge.
 *
 * When storage is empty, it mints the **same** implicit rule set the popup
 * opens on — it calls `bootstrapProfile()` rather than writing that shape
 * again.
 */
/**
 * Returns the rule set to touch, together with the state it actually lives
 * in.
 *
 * **Call it lazily.** `pause` only touches the top-level key, so it must not
 * call this — calling it would mint a rule set nobody asked for on an empty
 * store. Call it only inside a case that actually touches the rule set.
 *
 * `minted` says whether this call just invoked `bootstrapProfile()`. `rule.add`
 * uses it to decide whether to delete that nameless first rule — it has to be
 * distinguished from an existing rule set that happens to hold exactly one
 * blank rule, which `active.headers` alone cannot tell apart.
 */
function seed(state: AppState): { base: AppState; active: Profile; minted: boolean } {
  const { profile } = resolveSingleProfile(state.profiles);
  if (profile) return { base: state, active: profile, minted: false };
  const bootstrapped = bootstrapProfile();
  return { base: { ...state, profiles: [bootstrapped] }, active: bootstrapped, minted: true };
}

function replace(base: AppState, next: Profile, changed: boolean, note?: string): ApplyResult {
  return {
    ok: true,
    state: { ...base, profiles: base.profiles.map((p) => (p.id === next.id ? next : p)) },
    changed,
    ...(note === undefined ? {} : { note }),
  };
}

export function apply(state: AppState, command: Command): ApplyResult {
  switch (command.cmd) {
    case 'site.add': {
      const { base, active } = seed(state);
      const existing = new Set(active.filter.domains.map(effectiveDomain));
      const fresh: string[] = [];
      const already: string[] = [];
      // `effectiveDomain` hands back the input verbatim when nothing usable
      // could be salvaged from it (origins.ts). Storing it anyway is right —
      // the row is how the user sees and fixes the mistake — but storing it
      // *silently* is not: once stored, `suppressionReason` returns
      // 'unusable-site' and the whole profile stops compiling, every good
      // rule along with it. "Never suppress without saying so" applies here
      // exactly as it does to a filter with no usable domain at all.
      const unusable: string[] = [];
      for (const typed of command.domains) {
        const host = effectiveDomain(typed);
        if (existing.has(host)) {
          already.push(host);
          continue;
        }
        existing.add(host);
        fresh.push(host);
        if (!isValidDomain(host)) unusable.push(host);
      }
      const domains = [...active.filter.domains, ...fresh];
      const notes: string[] = [];
      if (already.length > 0) notes.push(`already listed: ${already.join(', ')}`);
      if (unusable.length > 0) {
        notes.push(
          `cannot scope anything and suppresses the whole rule set until fixed: ${unusable.join(', ')}`,
        );
      }
      const note = notes.length === 0 ? undefined : notes.join('; ');
      return replace(
        base,
        { ...active, filter: { ...active.filter, domains } },
        fresh.length > 0,
        note,
      );
    }

    case 'site.remove': {
      const { base, active } = seed(state);
      // Check that all of them are present first, and remove nothing at all
      // if even one is missing. A partial apply would make "what got
      // removed" a question the caller has to ask back.
      const wanted = command.domains.map(effectiveDomain);
      const present = new Set(active.filter.domains.map(effectiveDomain));
      const missing = wanted.filter((host) => !present.has(host));
      if (missing.length > 0) {
        return {
          ok: false,
          error: { code: 'unknown-domain', message: `not in the site list: ${missing.join(', ')}` },
        };
      }
      const drop = new Set(wanted);
      const domains = active.filter.domains.filter((d) => !drop.has(effectiveDomain(d)));
      return replace(base, { ...active, filter: { ...active.filter, domains } }, true);
    }

    case 'site.allSites': {
      const { base, active } = seed(state);
      if (active.filter.allSites === command.on) return replace(base, active, false);
      // Keep the list. That is what makes the switch reversible — turning it
      // off brings back the scope the user built up.
      return replace(base, { ...active, filter: { ...active.filter, allSites: command.on } }, true);
    }

    case 'rule.add': {
      const { base, active, minted } = seed(state);
      // `remove` carries no value (types.ts). Drop it here so the stored
      // shape is always one shape — so a dead value never reads as if it
      // meant something.
      const value = command.operation === 'remove' ? '' : command.value;
      const rule = {
        ...newRule(),
        target: command.target,
        operation: command.operation,
        name: command.name,
        value,
      };
      // `bootstrapProfile()` mints one rule with neither a name nor a value
      // alongside it. Leaving that in place and appending the requested rule
      // onto a store that was just born from it would turn a single `rule
      // add` on a fresh install into two rules — the one asked for, and one
      // nobody requested that sits forever as `incomplete-header`. This is
      // the same boundary case `site.add` already handles for an empty
      // store. `minted` is what draws the line — it must not overwrite an
      // existing rule set that happens to hold exactly one blank rule.
      const blank =
        active.headers.length === 1 &&
        active.headers[0]!.name === '' &&
        active.headers[0]!.value === '';
      const headers = minted && blank ? [rule] : [...active.headers, rule];
      return replace(base, { ...active, headers }, true);
    }

    case 'rule.remove': {
      const { base, active } = seed(state);
      if (!active.headers.some((h) => h.id === command.id)) {
        return {
          ok: false,
          error: { code: 'unknown-rule', message: `no rule with id ${command.id}` },
        };
      }
      return replace(
        base,
        { ...active, headers: active.headers.filter((h) => h.id !== command.id) },
        true,
      );
    }

    case 'rule.toggle': {
      const { base, active } = seed(state);
      const current = active.headers.find((h) => h.id === command.id);
      if (!current) {
        return {
          ok: false,
          error: { code: 'unknown-rule', message: `no rule with id ${command.id}` },
        };
      }
      const next = command.on ?? !current.enabled;
      if (next === current.enabled) return replace(base, active, false);
      return replace(
        base,
        {
          ...active,
          headers: active.headers.map((h) => (h.id === command.id ? { ...h, enabled: next } : h)),
        },
        true,
      );
    }

    case 'pause':
    case 'resume': {
      const paused = command.cmd === 'pause';
      // `state`, not `seeded`. Pause is a top-level key, and it must not
      // cause a rule set to be minted.
      if (state.globalPause === paused) return { ok: true, state, changed: false };
      return { ok: true, state: { ...state, globalPause: paused }, changed: true };
    }

    case 'state.set': {
      try {
        // A store that fails validation is never compiled, so there is
        // nothing to neutralize and no grounds for overwriting someone
        // else's bytes. Refuse it and leave the state alone.
        return { ok: true, state: parseAppState(command.state), changed: true };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'invalid-state',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }

    default: {
      // The nine cases above are the whole of `Command`, so type-wise this is
      // unreachable — `command` narrows to `never`. It is not deleted anyway:
      // this is the last line of defense when a call bypasses `parseCommand`
      // and gets in around the type. Reading that value means widening the
      // narrowed type back out. Widening it *through* `never` is the point —
      // casting straight from `command` would let a tenth command get added
      // with no case and still compile, so the missing case would leave
      // silently as a runtime `invalid-command`. A measured difference.
      const exhaustive: never = command;
      const unexpected = exhaustive as Command;
      return {
        ok: false,
        error: { code: 'invalid-command', message: `unhandled command: ${unexpected.cmd}` },
      };
    }
  }
}
