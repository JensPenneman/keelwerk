import type { SystemFields } from '../fields/system-fields.ts';
import type { AnyModuleBase } from './any-module-base.ts';
import type { ConditionalFields } from './conditional-fields.ts';
import type { EntityAt } from './entities-of.ts';
import type { FieldsOf } from './fields-of.ts';
import type { Prettify } from './prettify.ts';
import type { PartialRowOf, RowOf } from './row-of.ts';
import type { RowView } from './row-view.ts';

/** A row of an own entity as the module sees it: its fields, and its conditional fields as optional. */
export type OwnRow<
  B extends AnyModuleBase,
  E extends string,
  View extends RowView = 'own',
> = Prettify<
  SystemFields<`${B['id']}.${E}`> &
    RowOf<FieldsOf<EntityAt<B, E>>, B['id'], View> &
    PartialRowOf<ConditionalFields<B, E>, B['id'], View>
>;

/** Every field record of an own entity: declared and conditional. */
export type OwnFields<B, E extends string> = FieldsOf<EntityAt<B, E>> & ConditionalFields<B, E>;
