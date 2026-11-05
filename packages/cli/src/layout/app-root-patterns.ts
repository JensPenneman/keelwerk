/** The app roots of section 23.8, as patterns over the directory below the workspace root. */
export const appRootPatterns: readonly RegExp[] = [
  /^apps\/[^/]+$/,
  /(^|\/)fixtures\/apps\/[^/]+$/,
  /^examples\/[^/]+\/apps\/[^/]+$/,
];
