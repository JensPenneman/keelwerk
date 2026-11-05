import type { Scope } from '../storage/scope.ts';
import type { InvocationSession } from './invocation-session.ts';
import type { ScopeTarget } from './scope-target.ts';

/** What `resolveScope` hands the next stages. */
export interface ResolvedScope {
  readonly scope: Scope;
  /** The app of the resolved backend; 'core' at deployment level. */
  readonly app: string;
  readonly resolvedBy: InvocationSession['resolvedBy'];
  /** Where the scope's own data lives; null at deployment level until the control store is wired. */
  readonly target: ScopeTarget | null;
  /** Where backend-scope actions of a tenant session run; null at backend and deployment level. */
  readonly backendTarget: ScopeTarget | null;
  /** The backend's validated configuration by module id; absent at deployment level. */
  readonly backendConfig?: Readonly<Record<string, unknown>>;
  /** The backend's or tenant's pinned API version. */
  readonly pinnedVersion?: string;
}
