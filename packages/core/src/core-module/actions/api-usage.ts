import { defineQuery } from '../../dsl/define-query.ts';
import { typedOutput } from '../../dsl/typed-output.ts';
import { errors } from '../../errors/errors.ts';
import { field } from '../../fields/field.ts';
import { shape } from '../../fields/shape.ts';
import type { ApiUsageDocument } from '../api-usage-document.ts';
import { coreBase } from '../base.ts';
import type { CoreLiteral } from '../core-type.ts';

/**
 * The `core.apiUsage` query (18.5, S-144): the request counts of `kw_api_usage` per backend,
 * tenant, API version, transport and item over a span of days. The runtime answers it; only
 * operators may ask.
 */
export const apiUsage: CoreLiteral['actions']['apiUsage'] = defineQuery(coreBase, {
  scope: 'deployment',
  principal: 'operator',
  input: shape({
    since: field.string().optional(),
    until: field.string().optional(),
    backendId: field.string().optional(),
    apiVersion: field.string().optional(),
    item: field.string().optional(),
  }),
  output: typedOutput<ApiUsageDocument>(),
  read: () => {
    throw errors.not_implemented('core.apiUsage is answered by the runtime.');
  },
});
