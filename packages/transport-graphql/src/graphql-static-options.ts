/** The static options of the GraphQL module: they shape the mount, never per-backend behaviour (section 16.3.5). */
export interface GraphqlStaticOptions {
  /** Where the host mounts the transport; default '/graphql'. */
  readonly path?: string;
}
