import type { ActionPart, PartTypes, RowOutput } from '../model/action-part.ts';
import type { InstanceInput } from '../model/instance-input.ts';
import type { ModuleOf } from '../model/module-of.ts';
import type { Prettify } from '../model/prettify.ts';
import type { Empty } from '../types/empty.ts';
import type { CoreBase } from './core-base-type.ts';

type CoreQuery<Out = unknown> = ActionPart<
  'query',
  CoreBase,
  null,
  'sync',
  PartTypes<Prettify<Empty>, Out, never, never>
>;
type TenantCommand<In> = ActionPart<
  'command',
  CoreBase,
  'tenant',
  'sync',
  PartTypes<
    Prettify<Prettify<In & {}> & InstanceInput<'core.tenant'>>,
    RowOutput<'core.tenant'>,
    never,
    never
  >
>;
type TokenCommand<In, Out> = ActionPart<
  'command',
  CoreBase,
  'operatorToken',
  'sync',
  PartTypes<Prettify<Prettify<In & {}> & InstanceInput<'core.operatorToken'>>, Out, never, never>
>;

/** The module literal of the core: the parts the core mounts (S-26, section 3.1). */
export interface CoreLiteral {
  readonly actions: {
    readonly introspect: CoreQuery;
    readonly composition: CoreQuery;
    readonly me: CoreQuery;
    readonly capabilities: CoreQuery;
  };
  readonly entityActions: {
    readonly tenant: {
      readonly enter: TenantCommand<{ readonly reason: string }>;
      readonly setApiVersion: TenantCommand<{ readonly apiVersion: string }>;
    };
    readonly operatorToken: {
      readonly revoke: TokenCommand<Empty, RowOutput<'core.operatorToken'>>;
    };
  };
}

/** The implicit core module, always first in a selection (decision 104, section 4.7). */
export interface Core extends ModuleOf<CoreBase, CoreLiteral> {}
