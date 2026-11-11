import type { AnyErrorDefinition } from '../errors/error-definition.ts';
import type { PrincipalKind } from '../principals/principal-kind.ts';

/** Options shared by every action (section 7.3). */
export interface ActionOptions<
  In,
  Out,
  Er extends readonly AnyErrorDefinition[],
  Pk extends PrincipalKind,
> {
  readonly input?: In;
  readonly output?: Out;
  readonly errors?: Er;
  readonly auth?: 'policy' | { readonly public: true };
  readonly principal?: Pk | readonly Pk[];
  readonly scope?: 'tenant' | 'backend' | 'deployment' | 'invocation';
  readonly idempotent?: boolean;
  readonly timeoutMs?: number;
  readonly hints?: { readonly [transport: string]: object };
  readonly description?: string;
  readonly deprecated?: { readonly reason: string; readonly at?: string; readonly sunset?: string };
  readonly gate?: string;
}
