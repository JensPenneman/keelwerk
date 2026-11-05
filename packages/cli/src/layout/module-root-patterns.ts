/** The module roots of S-13 and the app roots of section 23.8, as patterns over the directory below the workspace root. */
export const moduleRootPatterns: readonly RegExp[] = [
  /^packages\/module-[^/]+$/,
  /(^|\/)fixtures\/modules\/[^/]+$/,
  /^modules\/[^/]+$/,
  /^examples\/[^/]+\/modules\/[^/]+$/,
];
