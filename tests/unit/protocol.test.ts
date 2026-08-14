import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { parseCommand } from '@/lib/bridge/protocol';

describe('parseCommand', () => {
  it('rejects a command it does not know', () => {
    expect(() => parseCommand({ cmd: 'rm -rf' })).toThrow(ZodError);
  });

  it('rejects a payload with no cmd at all', () => {
    expect(() => parseCommand({ domains: ['example.com'] })).toThrow(ZodError);
  });

  it('reads site.add with its domains', () => {
    expect(parseCommand({ cmd: 'site.add', domains: ['a.example.com'] })).toEqual({
      cmd: 'site.add',
      domains: ['a.example.com'],
    });
  });

  // A command that cannot change anything is a mistake worth naming, not a
  // no-op worth accepting: the caller asked for something and nothing would
  // happen, with nothing said.
  it('rejects site.add with an empty domain list', () => {
    expect(() => parseCommand({ cmd: 'site.add', domains: [] })).toThrow(ZodError);
  });

  it('rejects site.add with an empty string as a domain', () => {
    expect(() => parseCommand({ cmd: 'site.add', domains: [''] })).toThrow(ZodError);
  });

  it('reads site.remove with its domains', () => {
    expect(parseCommand({ cmd: 'site.remove', domains: ['a.example.com'] })).toEqual({
      cmd: 'site.remove',
      domains: ['a.example.com'],
    });
  });

  it('rejects site.remove with an empty domain list', () => {
    expect(() => parseCommand({ cmd: 'site.remove', domains: [] })).toThrow(ZodError);
  });

  it('reads site.allSites in both directions', () => {
    expect(parseCommand({ cmd: 'site.allSites', on: true })).toEqual({
      cmd: 'site.allSites',
      on: true,
    });
    expect(parseCommand({ cmd: 'site.allSites', on: false })).toEqual({
      cmd: 'site.allSites',
      on: false,
    });
  });

  // The mode is never inferred. Defaulting it would let a malformed command
  // silently turn all-sites off, which is a scope change nobody asked for.
  it('rejects site.allSites without an explicit on', () => {
    expect(() => parseCommand({ cmd: 'site.allSites' })).toThrow(ZodError);
  });

  it('defaults rule.add value to the empty string', () => {
    expect(
      parseCommand({ cmd: 'rule.add', target: 'request', operation: 'remove', name: 'X-Trace' }),
    ).toEqual({
      cmd: 'rule.add',
      target: 'request',
      operation: 'remove',
      name: 'X-Trace',
      value: '',
    });
  });

  it('rejects a target the model does not have', () => {
    expect(() =>
      parseCommand({ cmd: 'rule.add', target: 'trailer', operation: 'set', name: 'X', value: '1' }),
    ).toThrow(ZodError);
  });

  // Omitted `on` means "flip it", which apply() resolves against the current
  // value. Requiring it would make the CLI read before every toggle.
  it('allows rule.toggle without an explicit on', () => {
    expect(parseCommand({ cmd: 'rule.toggle', id: 'r1' })).toEqual({
      cmd: 'rule.toggle',
      id: 'r1',
    });
  });

  it('reads rule.toggle with an explicit on', () => {
    expect(parseCommand({ cmd: 'rule.toggle', id: 'r1', on: false })).toEqual({
      cmd: 'rule.toggle',
      id: 'r1',
      on: false,
    });
  });

  it('reads rule.remove with its id', () => {
    expect(parseCommand({ cmd: 'rule.remove', id: 'r1' })).toEqual({
      cmd: 'rule.remove',
      id: 'r1',
    });
  });

  it('rejects rule.remove with an empty id', () => {
    expect(() => parseCommand({ cmd: 'rule.remove', id: '' })).toThrow(ZodError);
  });

  it('reads pause and resume, which carry nothing', () => {
    expect(parseCommand({ cmd: 'pause' })).toEqual({ cmd: 'pause' });
    expect(parseCommand({ cmd: 'resume' })).toEqual({ cmd: 'resume' });
  });

  // The payload is deliberately unknown here. Validating it against
  // appStateSchema is apply()'s job, so that a bad payload comes back as a
  // structured invalid-state error rather than as a parse throw three
  // processes away from the person who typed it.
  it('accepts state.set without judging its payload', () => {
    expect(parseCommand({ cmd: 'state.set', state: { nonsense: true } })).toEqual({
      cmd: 'state.set',
      state: { nonsense: true },
    });
  });
});
