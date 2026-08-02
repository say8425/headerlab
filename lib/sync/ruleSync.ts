import { browser, type Browser } from 'wxt/browser';
import { compile } from '@/lib/compile/compile';
import { getState } from '@/lib/storage/state';
import { setSyncStatus, type SyncStatus } from '@/lib/storage/session';
import type { CompileResult, DnrRule } from '@/lib/model/types';

/**
 * The only module permitted to call chrome.declarativeNetRequest.
 *
 * It makes no decisions: it replaces whatever is registered with whatever it is
 * handed. updateDynamicRules/updateSessionRules remove before they add and are
 * fully transactional, so a failure leaves the previous rules intact rather
 * than a half-applied set.
 */
async function replace(
  scope: 'dynamic' | 'session',
  rules: DnrRule[],
): Promise<void> {
  const dnr = browser.declarativeNetRequest;
  const existing =
    scope === 'dynamic' ? await dnr.getDynamicRules() : await dnr.getSessionRules();

  // Our DnrRule is structurally identical to the wxt/browser namespace's Rule
  // but nominally separate, so lib/compile/ can stay free of browser types
  // (see Task 2). This boundary is the one place the two meet, and the one
  // place the cast belongs.
  const update = {
    removeRuleIds: existing.map((r) => r.id),
    addRules: rules as unknown as Browser.declarativeNetRequest.Rule[],
  };

  if (scope === 'dynamic') {
    await dnr.updateDynamicRules(update);
  } else {
    await dnr.updateSessionRules(update);
  }
}

export async function syncRules(
  result: Pick<CompileResult, 'dynamic' | 'session'>,
): Promise<void> {
  await replace('dynamic', result.dynamic);
  await replace('session', result.session);
}

/**
 * The single entry point every trigger funnels into: recompile from storage and
 * replace everything. Idempotent, so there is nowhere for state drift to hide —
 * but idempotence alone does not serialize concurrent calls, and replace()
 * above is a read-then-write (getDynamicRules() then updateDynamicRules()). The
 * popup saves on every keystroke and the background re-triggers on every
 * storage change, so two reconciles overlap routinely; without a guard, the
 * one that started earlier (and read older state) can finish later and leave
 * a stale rule set registered.
 *
 * The fix is an in-flight latch with a trailing rerun: a call that arrives
 * while one is already running does not start a second, independent pass — it
 * marks a rerun and rides the same in-flight promise, which loops once more
 * before settling. Every caller in the overlap window resolves only once the
 * latest state has actually been applied.
 */
let inFlight: Promise<void> | null = null;
let rerunQueued = false;

export async function reconcile(): Promise<void> {
  if (inFlight) {
    rerunQueued = true;
    return inFlight;
  }

  inFlight = (async () => {
    try {
      do {
        rerunQueued = false;
        const state = await getState();
        const result = compile(state);
        try {
          await syncRules(result);
        } catch (error) {
          await recordStatus({
            lastError: error instanceof Error ? error.message : String(error),
            ruleCount: 0,
          });
          // Recording is a side record — the failure still propagates
          // exactly as before, console log and all (see background.ts).
          throw error;
        }
        await recordStatus({
          lastError: null,
          ruleCount: result.dynamic.length + result.session.length,
        });
      } while (rerunQueued);
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Design §6.2: a reconcile failure's message goes to session storage so the
 * popup can show it. This is best-effort — a storage write failing here must
 * never turn a successful reconcile into a failed one, nor swallow a real
 * reconcile error by throwing over it.
 */
async function recordStatus(status: SyncStatus): Promise<void> {
  try {
    await setSyncStatus(status);
  } catch (error) {
    console.error('[HeaderLab] failed to record sync status', error);
  }
}
