/** One value per supported API version, built at first use and kept. */
export interface VersionProjection<P> {
  /** The supported versions, oldest first. */
  readonly versions: readonly string[];
  /** The value at one version; throws `RangeError` for a version outside `versions`. */
  at(apiVersion: string): P;
}

/**
 * A projection over the given versions: `build` runs once per version, on the first `at` of it, and
 * its result is kept (section 18.2). A version outside `versions` throws `RangeError`; the session's
 * version is always one the app declares.
 */
export function versionProjection<P>(
  versions: readonly string[],
  build: (apiVersion: string) => P,
): VersionProjection<P> {
  const built = new Map<string, P>();
  return {
    versions,
    at: (apiVersion) => {
      if (!versions.includes(apiVersion)) {
        throw new RangeError(`'${apiVersion}' is not a supported API version.`);
      }
      if (built.has(apiVersion)) return built.get(apiVersion) as P;
      const value = build(apiVersion);
      built.set(apiVersion, value);
      return value;
    },
  };
}
