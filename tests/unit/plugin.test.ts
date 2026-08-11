import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('the plugin manifests', () => {
  const claude = JSON.parse(readFileSync('packages/plugin/.claude-plugin/plugin.json', 'utf8'));
  const codex = JSON.parse(readFileSync('packages/plugin/.codex-plugin/plugin.json', 'utf8'));

  // Both are rewritten by the CLI's release through extra-files. If they ever
  // disagree, one of the two paths stopped being written and nothing said so.
  it('carries one version across both manifests', () => {
    expect(claude.version).toBe(codex.version);
  });

  it('uses strict semver, which is what Codex validates', () => {
    expect(claude.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  // Verified against the validator shipped inside the codex binary: name,
  // version, description, author (object with name) and interface with seven
  // fields are all required, and `hooks` is rejected outright.
  it('gives Codex every field its validator requires', () => {
    expect(codex.author?.name).toBeTruthy();
    expect(Object.keys(codex.interface ?? {}).sort()).toEqual(
      [
        'capabilities',
        'category',
        'defaultPrompt',
        'developerName',
        'displayName',
        'longDescription',
        'shortDescription',
      ].sort(),
    );
    expect(codex).not.toHaveProperty('hooks');
  });

  // Measured: a marketplace entry carrying its own version creates a drift
  // class, and disagreement makes install exit 1. One number, one file.
  it('keeps the version out of the marketplace entry', () => {
    const market = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'));
    expect(market.plugins[0]).not.toHaveProperty('version');
  });

  // No declarative preflight exists, so the skill must run one. Prose asking
  // the model to notice a missing binary is a silent failure by this repo's
  // own definition.
  it('makes the skill check for its CLI before its content is read', () => {
    const skill = readFileSync('packages/plugin/skills/headerlab/SKILL.md', 'utf8');
    expect(skill).toContain('command -v headerlab');
  });
});
