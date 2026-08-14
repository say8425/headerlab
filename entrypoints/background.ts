import { browser } from 'wxt/browser';
import { refreshBridge } from '@/lib/bridge/port';
import { stateItem } from '@/lib/storage/state';
import { reconcile } from '@/lib/sync/ruleSync';

export default defineBackground(() => {
  const run = () => {
    reconcile().catch((error) => {
      console.error('[HeaderLab] reconcile failed', error);
    });
  };

  // The bridge rides the same triggers, minus one. It is deliberately not on
  // `stateItem.watch`: a state write is not a reason to re-open a native port,
  // and since applying a bridge command *is* a state write, wiring it there
  // would make every command re-enter the adapter that just handled it.
  //
  // These four are also the whole of the reconnection strategy. The port keeps
  // the worker alive on its own (measured: seven minutes with no traffic), so
  // the cases where it really dies — browser restart, extension reload, crash,
  // and a permission arriving or going away — are exactly what these already
  // fire on. No heartbeat, and no `alarms` permission to pay for one.
  const syncBridge = () => {
    refreshBridge().catch((error) => {
      console.error('[HeaderLab] bridge refresh failed', error);
    });
  };

  // Every trigger funnels into the same idempotent reconcile.
  run();
  syncBridge();
  browser.runtime.onStartup.addListener(run);
  browser.runtime.onStartup.addListener(syncBridge);
  browser.runtime.onInstalled.addListener(run);
  browser.runtime.onInstalled.addListener(syncBridge);
  browser.permissions.onAdded.addListener(run);
  browser.permissions.onAdded.addListener(syncBridge);
  browser.permissions.onRemoved.addListener(run);
  browser.permissions.onRemoved.addListener(syncBridge);
  stateItem.watch(run);
});
