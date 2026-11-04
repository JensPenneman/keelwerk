import { defineQuery } from '../../dsl/define-query.ts';
import { typedOutput } from '../../dsl/typed-output.ts';
import { errors } from '../../errors/errors.ts';
import type { CapabilitiesDocument } from '../../invoker/capabilities-document.ts';
import { coreBase } from '../base.ts';
import type { CoreLiteral } from '../core-type.ts';

/** The `core.capabilities` query (S-26). */
export const capabilities: CoreLiteral['actions']['capabilities'] = defineQuery(coreBase, {
  scope: 'backend',
  auth: { public: true },
  output: typedOutput<CapabilitiesDocument>(),
  read: () => {
    throw errors.not_implemented('core.capabilities is answered by the runtime.');
  },
});
