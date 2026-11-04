import type { SystemFields } from '../fields/system-fields.ts';
import type { AnyModule } from './any-module.ts';
import type { AnyModuleBase } from './any-module-base.ts';
import type { ContributedFields } from './contributed-member.ts';
import type { EntityAt } from './entities-of.ts';
import type { FieldsOf } from './fields-of.ts';
import type { Prettify } from './prettify.ts';
import type { PartialRowOf, RowOf } from './row-of.ts';
import type { RowView } from './row-view.ts';

/** A row of a dependency's entity: its own fields without hidden ones, plus what this module contributes. */
export type DependencyRow<
  B extends AnyModuleBase,
  W,
  D extends AnyModule,
  E extends string,
  View extends RowView = 'dependency',
> = Prettify<
  SystemFields<`${D['id']}.${E}`> &
    RowOf<FieldsOf<EntityAt<D, E>>, D['id'], View> &
    PartialRowOf<ContributedFields<B, W, D['id'], E>, B['id'], View>
>;
