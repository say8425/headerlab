import { browser } from 'wxt/browser';
import { hasBridge } from '@/lib/compile/capabilities';
import { refreshBridge } from '@/lib/bridge/port';
import { isBridgeRefresh } from '@/lib/bridge/protocol';
import { TARGET } from '@/lib/target';
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
  // These five are also the whole of the reconnection strategy. The port keeps
  // the worker alive on its own (measured: seven minutes with no traffic), so
  // the cases where it really dies — browser restart, extension reload, crash,
  // and a permission arriving or going away — are exactly what these already
  // fire on — plus the popup opening (below), which is the one a person who
  // has just run `headerlab bridge install` can cause without a reload. No
  // heartbeat, and no `alarms` permission to pay for one.
  const syncBridge = () => {
    refreshBridge().catch((error) => {
      console.error('[HeaderLab] bridge refresh failed', error);
    });
  };

  // Every trigger funnels into the same idempotent reconcile.
  run();
  browser.runtime.onStartup.addListener(run);
  browser.runtime.onInstalled.addListener(run);
  browser.permissions.onAdded.addListener(run);
  browser.permissions.onRemoved.addListener(run);
  stateItem.watch(run);

  // A target with no bridge has no permission to probe and no port to open;
  // running the adapter there would write a `bridgeStatus` record about a
  // bridge that cannot exist.
  if (!hasBridge(TARGET)) return;
  syncBridge();
  browser.runtime.onStartup.addListener(syncBridge);
  browser.runtime.onInstalled.addListener(syncBridge);
  browser.permissions.onAdded.addListener(syncBridge);
  browser.permissions.onRemoved.addListener(syncBridge);
  // Always answered: Chrome rejects the sender's promise when no listener
  // replies, and the popup would then say a retry "could not be sent" when it
  // ran. `sendResponse` plus `return true` rather than returning a Promise,
  // because Promise returns from `onMessage` are recent in Chrome and this
  // manifest pins no minimum version. The outcome is not in the reply — it
  // lands in `bridgeStatus`, which the popup already watches.
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isBridgeRefresh(message)) return false;
    refreshBridge().then(
      () => sendResponse(true),
      (error: unknown) => {
        console.error('[HeaderLab] bridge refresh failed', error);
        sendResponse(false);
      },
    );
    return true;
  });
});
