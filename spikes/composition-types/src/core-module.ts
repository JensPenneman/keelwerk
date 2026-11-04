import type { ActionPart, PartTypes } from './action-part.ts';
import { defineEntity, type Entity } from './define-entity.ts';
import { defineModule, type ModuleOf } from './define-module.ts';
import { defineModuleBase } from './define-module-base.ts';
import { defineQuery } from './define-query.ts';
import { type FieldDef, field, type NoFlags, type OwnRef } from './field.ts';

type Text = FieldDef<string, NoFlags, null, 'string'>;
type CoreQuery = ActionPart<'query', CoreBase, null, 'sync', PartTypes<{}, unknown, never, never>>;

const backend = defineEntity({
  prefix: 'bknd',
  fields: { name: field.string(), app: field.string(), placement: field.string() },
  tenancy: 'deployment',
});
const tenant = defineEntity({
  prefix: 'tnt',
  fields: {
    backendId: field.ref.own('backend'),
    name: field.string(),
    domains: field.list(field.string()),
  },
  tenancy: 'backend',
});
const commandReceipt = defineEntity({
  prefix: 'rcpt',
  fields: { commandId: field.string() },
  history: 'state',
  generated: { set: false },
});
const coreBase: CoreBase = defineModuleBase({
  id: 'core',
  version: '0.0.0',
  entities: { backend, tenant, commandReceipt },
});
const introspect = defineQuery(coreBase, { read: () => undefined });
const me = defineQuery(coreBase, { read: () => undefined });

/** The base of the implicit core module, written out because the core compiles with isolatedDeclarations. */
export interface CoreBase {
  readonly id: 'core';
  readonly version: '0.0.0';
  readonly entities: {
    readonly backend: Entity<
      'bknd',
      { readonly name: Text; readonly app: Text; readonly placement: Text },
      {},
      'chain',
      {},
      {}
    >;
    readonly tenant: Entity<
      'tnt',
      {
        readonly backendId: FieldDef<never, NoFlags, OwnRef<'backend'>, 'ref'>;
        readonly name: Text;
        readonly domains: FieldDef<readonly string[], NoFlags, null, 'list'>;
      },
      {},
      'chain',
      {},
      {}
    >;
    readonly commandReceipt: Entity<
      'rcpt',
      { readonly commandId: Text },
      {},
      'state',
      { readonly set: false },
      {}
    >;
  };
}

/** The module literal of the core. */
export interface CoreLiteral {
  readonly actions: { readonly introspect: CoreQuery; readonly me: CoreQuery };
}

/** The implicit core module, always first in a selection (section 4.7). */
export interface Core extends ModuleOf<CoreBase, CoreLiteral> {}

/** The implicit core module. */
export const core: Core = defineModule(coreBase, { actions: { introspect, me } });
