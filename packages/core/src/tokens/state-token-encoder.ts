import type { QueryStateEncoder } from '../interpreter/query-state-encoder.ts';
import { issueStateToken } from './issue-state-token.ts';
import type { StateTokenContext } from './state-token-context.ts';

/**
 * The `QueryStateEncoder` of the invoker: the `queryState` of a `query` load is the signed token
 * of section 15.2.6 for the entity, filter and sort it read. A read without a source (none in
 * M1) falls back to the decimal position.
 */
export function stateTokenEncoder(context: StateTokenContext): QueryStateEncoder {
  return (position, scope, source) => {
    if (source === undefined || scope.level === 'namespace') return position.toString();
    return issueStateToken(context, source.entity, scope, position, {
      query: { filter: source.filter, sort: source.sort },
    });
  };
}
