/** The physical root of an app's namespace on a placement: the app id with dashes as underscores (S-09). */
export function namespaceRootOf(appId: string): string {
  return appId.replaceAll('-', '_');
}
