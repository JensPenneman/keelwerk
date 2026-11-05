import { defineQuery } from '../../dsl/define-query.ts';
import { typedOutput } from '../../dsl/typed-output.ts';
import { errors } from '../../errors/errors.ts';
import { coreBase } from '../base.ts';
import type { CoreLiteral } from '../core-type.ts';
import type { MeDocument } from '../me-document.ts';

/** The `core.me` query (S-26, section 8.7): the principal and its effective rules in CASL raw-rule shape; the runtime answers it, and every principal, anonymous included, may ask about itself. */
export const me: CoreLiteral['actions']['me'] = defineQuery(coreBase, {
  scope: 'backend',
  auth: { public: true },
  output: typedOutput<MeDocument>(),
  read: () => {
    throw errors.not_implemented('core.me is answered by the runtime.');
  },
});
