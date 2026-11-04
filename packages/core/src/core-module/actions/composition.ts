import { defineQuery } from '../../dsl/define-query.ts';
import { coreBase } from '../base.ts';
import type { CoreLiteral } from '../core-type.ts';

/** The `core.composition` query (S-26). */
export const composition: CoreLiteral['actions']['composition'] = defineQuery(coreBase, {
  scope: 'backend',
  principal: 'operator',
  read: () => undefined,
});
