import type { AnyModuleBase } from '../model/any-module-base.ts';
import type { PrincipalKind } from '../principals/principal-kind.ts';
import type { DecideContext } from './decide-context.ts';
import type { SecretRequests } from './secret-requests.ts';

/** The context of `read` (section 7.6): no write side, no ids, random values or issued secrets; `target` in entity queries. */
export interface ReadContext<
  B extends AnyModuleBase,
  W = readonly [],
  Pk extends PrincipalKind = PrincipalKind,
  T = never,
> extends Omit<
    DecideContext<B, W, undefined, Pk>,
    'write' | 'events' | 'prepared' | 'newId' | 'random' | 'secrets'
  > {
  readonly secrets: Pick<SecretRequests, 'reveal' | 'verify'>;
  readonly target: T;
}
