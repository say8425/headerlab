/**
 * Hand-written declarations for `manifest.mjs`, whose exports are consumed
 * from TypeScript exactly once — `tests/unit/bridgeName.test.ts`, the guard
 * that keeps `HOST_NAME` in sync with `lib/bridge/port.ts`'s
 * `NATIVE_HOST_NAME`. Without this file, `tsc --noEmit` fails that import
 * with TS7016 (`allowJs` is off, so a plain `.mjs` has no inferred shape) —
 * not a defect in the source, just the one place a Node module crosses into
 * typechecked TypeScript.
 */

export declare const HOST_NAME: string;
export declare const MANIFEST_FILE_NAME: string;

export declare function unpackedExtensionId(loadPath: string): string;

export declare function nativeMessagingDir(options: {
  platform: string;
  home?: string;
  userDataDir?: string;
  browser?: string;
}): string;

export declare function hostManifest(options: { launcherPath: string; extensionId: string }): {
  name: string;
  description: string;
  path: string;
  type: string;
  allowed_origins: string[];
};

export declare function launcherScript(options: { nodePath: string; entryPath: string }): string;
