import { defineQuery } from '../../dsl/define-query.ts';
import { typedOutput } from '../../dsl/typed-output.ts';
import { errors } from '../../errors/errors.ts';
import type { ApiSurface } from '../../surface/api-surface.ts';
import { coreBase } from '../base.ts';
import type { CoreLiteral } from '../core-type.ts';

/**
 * The `core.introspect` query (S-26, section 16.2.5): the surface at the session's API version.
 * The runtime answers it from `deriveSurface`; its rule allows any signed-in principal.
 */
export const introspect: CoreLiteral['actions']['introspect'] = defineQuery(coreBase, {
  scope: 'backend',
  output: typedOutput<ApiSurface>(),
  read: () => {
    throw errors.not_implemented('core.introspect is answered by the runtime.');
  },
});
