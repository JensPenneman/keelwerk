/** One row of kw__control.kw_namespace_identities (section 14.7.6, S-119). */
export interface NamespaceIdentity {
  readonly namespaceId: string;
  /** PostgreSQL: the system identifier. */
  readonly systemId: string;
  readonly timeline: string;
  readonly recordedAt: Temporal.Instant;
}
