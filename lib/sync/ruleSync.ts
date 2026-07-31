import { browser, type Browser } from 'wxt/browser';
import { compile } from '@/lib/compile/compile';
import { getState } from '@/lib/storage/state';
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
 * replace everything. Idempotent, so there is nowhere for state drift to hide.
 */
export async function reconcile(): Promise<void> {
  const state = await getState();
  await syncRules(compile(state));
}
