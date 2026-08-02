import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { getSyncStatus, setSyncStatus } from '@/lib/storage/session';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('sync status', () => {
  it('starts clean', async () => {
    expect(await getSyncStatus()).toEqual({ lastError: null, ruleCount: 0 });
  });

  it('round-trips a failure message', async () => {
    await setSyncStatus({ lastError: 'Rule 3 is invalid', ruleCount: 0 });
    expect((await getSyncStatus()).lastError).toBe('Rule 3 is invalid');
  });

  it('clears the message on a later success', async () => {
    await setSyncStatus({ lastError: 'boom', ruleCount: 0 });
    await setSyncStatus({ lastError: null, ruleCount: 4 });
    expect(await getSyncStatus()).toEqual({ lastError: null, ruleCount: 4 });
  });
});
