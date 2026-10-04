/**
 * The one command that makes a bridge possible for *this* install.
 *
 * Built from the id the browser assigned, never a constant: the store build's
 * id is fixed, but an unpacked build's id comes from its load path, and a
 * command naming the wrong id installs a manifest Chrome refuses with the same
 * message as no manifest at all.
 */
export function bridgeInstallCommand(extensionId: string): string {
  return `headerlab bridge install --extension-id ${extensionId}`;
}
