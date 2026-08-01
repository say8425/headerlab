import { browser } from 'wxt/browser';
import { stateItem } from '@/lib/storage/state';
import { reconcile } from '@/lib/sync/ruleSync';

export default defineBackground(() => {
  const run = () => {
    reconcile().catch((error) => {
      console.error('[HeaderLab] reconcile failed', error);
    });
  };

  // Every trigger funnels into the same idempotent reconcile.
  run();
  browser.runtime.onStartup.addListener(run);
  browser.runtime.onInstalled.addListener(run);
  browser.permissions.onAdded.addListener(run);
  browser.permissions.onRemoved.addListener(run);
  stateItem.watch(run);
});
