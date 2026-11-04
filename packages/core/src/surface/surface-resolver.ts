/** One principal resolver as the surface describes it, for the security schemes of the OpenAPI document (section 8.5). */
export interface SurfaceResolver {
  /** 'auth.session', 'api-keys.key', 'core.operator'. */
  readonly id: string;
  readonly scheme: 'bearer' | 'cookie' | 'apiKey';
  readonly name?: string;
  readonly description?: string;
}
