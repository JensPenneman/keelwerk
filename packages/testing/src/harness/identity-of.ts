/** Maps the identity a database reports to the one its adapter answers (a test's stand-in for a point-in-time recovery). */
export type IdentityOf = (identity: { readonly systemId: string; readonly timeline: string }) => {
  readonly systemId: string;
  readonly timeline: string;
};
