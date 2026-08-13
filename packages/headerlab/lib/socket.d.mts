/**
 * Hand-written declarations for `socket.mjs`, whose exports are consumed
 * from TypeScript exactly once — `tests/e2e/bridge-fixtures.ts`, which needs
 * the same per-user socket directory a real Chrome-launched host resolves.
 * Without this file, `tsc --noEmit` fails that import with TS7016
 * (`allowJs` is off, so a plain `.mjs` has no inferred shape) — the same gap
 * `packages/headerlab/lib/manifest.d.mts` closes for `manifest.mjs`.
 */

export declare function socketDir(): string;

export declare function socketPathFor(dir: string, pid: number): string;

export declare function registryPathFor(dir: string, pid: number): string;

export declare function isSocketAlive(socketPath: string): Promise<boolean>;
