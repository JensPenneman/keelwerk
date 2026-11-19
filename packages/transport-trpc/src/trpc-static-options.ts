/** The static options of the tRPC module: they shape the mount and the router type, never per-backend behaviour (section 16.3.5). */
export interface TrpcStaticOptions {
  /** Where the host mounts the transport; default '/trpc'. */
  readonly path?: string;
  /** Default 'superjson'; 'json' is the plain wire of section 16.4.2 and `TrpcRouterOf<App, false>`. */
  readonly transformer?: 'superjson' | 'json';
}
