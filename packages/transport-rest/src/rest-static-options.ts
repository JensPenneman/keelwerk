/** The static options of the REST module: they shape artefacts and routes, never per-backend behaviour (section 16.3.5). */
export interface RestStaticOptions {
  /** Where the host mounts the transport; default '/api'. */
  readonly basePath?: string;
  /** The OpenAPI dialect the emitter targets; default '3.1'. `QUERY` operations need '3.2'. */
  readonly openapi?: '3.1' | '3.2';
}
