import { defineQuery } from '../../dsl/define-query.ts';
import { coreBase } from '../base.ts';
import type { CoreLiteral } from '../core-type.ts';

/** The `core.capabilities` query (S-26). */
export const capabilities: CoreLiteral['actions']['capabilities'] = defineQuery(coreBase, {
  scope: 'backend',
  auth: { public: true },
  read: () => undefined,
});
