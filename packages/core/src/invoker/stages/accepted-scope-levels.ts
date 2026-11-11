import type { ActionEntry } from '../../registry/action-entry.ts';
import type { Scope } from '../../storage/scope.ts';

/** The session scope levels an action of each scope level accepts (section 8.8): backend actions also from tenant sessions, which run in the tenant's own backend unit. */
export const acceptedScopeLevels: Readonly<
  Record<ActionEntry['scope'], readonly Scope['level'][]>
> = {
  tenant: ['tenant'],
  backend: ['backend', 'tenant'],
  deployment: ['deployment'],
  invocation: ['tenant', 'backend', 'deployment'],
};
