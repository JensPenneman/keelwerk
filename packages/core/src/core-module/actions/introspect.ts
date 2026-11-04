import { defineQuery } from '../../dsl/define-query.ts';
import { coreBase } from '../base.ts';
import type { CoreLiteral } from '../core-type.ts';

/** The `core.introspect` query (S-26). */
export const introspect: CoreLiteral['actions']['introspect'] = defineQuery(coreBase, {
  scope: 'backend',
  read: () => undefined,
});
