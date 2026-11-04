/** One placement of `defineDeployment`: where namespaces live and how they are laid out (section 14.4). */
export interface PlacementConfig {
  readonly id: string;
  /** Resolved through the secrets extension point. */
  readonly url?: string;
  readonly strategy: 'shared-tables' | 'schema-per-tenant' | 'database-per-tenant';
  /** Apps whose namespaces this placement hosts; default: all. */
  readonly apps?: readonly string[];
  readonly naming?: { readonly root?: string; readonly style?: 'prefix' | 'schema' };
  readonly pool?: { readonly max?: number; readonly idleTimeoutMs?: number };
  readonly options?: Readonly<Record<string, unknown>>;
}
