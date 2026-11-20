/** The static options of the oRPC module: they shape the mount, never per-backend behaviour (section 16.3.5). */
export interface OrpcStaticOptions {
  /** Where the host mounts the RPC handler; default '/orpc'. */
  readonly path?: string;
  /** 'orpc' (default): oRPC's serialiser with `orpcJsonSerializers`; 'json': the plain JSON of section 16.4.2. */
  readonly serializer?: 'orpc' | 'json';
  /** The prefix of oRPC's OpenAPI handler; absent: it is not mounted. */
  readonly openapi?: string;
}
