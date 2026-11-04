import { defineQuery } from '../../dsl/define-query.ts';
import { coreBase } from '../base.ts';
import type { CoreLiteral } from '../core-type.ts';

/** The `core.me` query (S-26). */
export const me: CoreLiteral['actions']['me'] = defineQuery(coreBase, {
  scope: 'backend',
  read: () => undefined,
});
