/**
 * Hand-written declarations for `install.mjs`, whose exports are consumed
 * from TypeScript exactly once — `tests/e2e/bridge-fixtures.ts`, which
 * installs and uninstalls the bridge into a throwaway Playwright profile.
 * Without this file, `tsc --noEmit` fails that import with TS7016
 * (`allowJs` is off, so a plain `.mjs` has no inferred shape) — the same gap
 * `packages/headerlab/lib/manifest.d.mts` closes for `manifest.mjs`.
 */

export declare function installBridge(options: {
  manifestDir: string;
  launcherDir: string;
  entryPath: string;
  nodePath: string;
  extensionId: string;
  socketDirPath: string;
}): Promise<
  | { ok: true; manifestPath: string; launcherPath: string; extensionId: string; verified: true }
  | { ok: false; error: { code: string; message: string } }
>;

export declare function uninstallBridge(options: {
  manifestDir: string;
  launcherDir: string;
}): Promise<{ ok: true; removed: string[] }>;

export declare function bridgeStatus(options: {
  manifestDir: string;
  launcherDir: string;
  socketDirPath: string;
}): Promise<Record<string, unknown>>;

export declare function defaultInstallPaths(options?: {
  userDataDir?: string | null;
  browser?: string;
}): {
  manifestDir: string;
  launcherDir: string;
  entryPath: string;
  nodePath: string;
  socketDirPath: string;
};
