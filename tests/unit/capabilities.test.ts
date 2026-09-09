import { describe, expect, it } from 'vitest';
import {
  BROWSER_NAME,
  SUPPORTED_RESOURCE_TYPES,
  hasBridge,
  supportedResourceTypes,
  unsupportedResourceTypes,
} from '@/lib/compile/capabilities';
import { RESOURCE_TYPES } from '@/lib/model/schema';

describe('resource types per target', () => {
  it('Chrome accepts every type the schema allows', () => {
    // Asserted against the schema's own list, not a literal: the two cannot
    // drift apart when a sixteenth type arrives.
    expect([...SUPPORTED_RESOURCE_TYPES.chrome].sort()).toEqual([...RESOURCE_TYPES].sort());
    expect(RESOURCE_TYPES).toHaveLength(15);
  });

  it('Firefox is missing exactly webtransport and webbundle', () => {
    // Measured 2026-09-08 (docs/research/2026-09-08-firefox-marionette-spike.md):
    // either one rejects the whole updateDynamicRules batch with
    // "Invalid enumeration value". BCD records both as version_added: false.
    const missing = RESOURCE_TYPES.filter((t) => !SUPPORTED_RESOURCE_TYPES.firefox.has(t));
    expect(missing.sort()).toEqual(['webbundle', 'webtransport']);
  });

  it('filters in the order given, keeping what the target knows', () => {
    expect(
      supportedResourceTypes('firefox', [
        'webbundle',
        'main_frame',
        'webtransport',
        'xmlhttprequest',
      ]),
    ).toEqual(['main_frame', 'xmlhttprequest']);
    expect(supportedResourceTypes('chrome', ['webbundle', 'main_frame'])).toEqual([
      'webbundle',
      'main_frame',
    ]);
  });

  it('names what it dropped, in the order given', () => {
    expect(
      unsupportedResourceTypes('firefox', ['webbundle', 'main_frame', 'webtransport']),
    ).toEqual(['webbundle', 'webtransport']);
    expect(unsupportedResourceTypes('chrome', ['webbundle', 'main_frame'])).toEqual([]);
  });
});

describe('the rest of the table', () => {
  it('offers the agent bridge on Chrome only', () => {
    // Firefox event pages close ports on idle (spec §9), so the bridge as
    // designed cannot run there and the popup must not offer it.
    expect(hasBridge('chrome')).toBe(true);
    expect(hasBridge('firefox')).toBe(false);
  });

  it('spells each browser the way copy will', () => {
    expect(BROWSER_NAME).toEqual({ chrome: 'Chrome', firefox: 'Firefox' });
  });
});
