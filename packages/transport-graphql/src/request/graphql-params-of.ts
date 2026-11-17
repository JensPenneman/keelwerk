import { coreError } from '@keelwerk/core/http';
import type { GraphqlParams } from './graphql-params.ts';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function malformed(message: string): Error {
  return coreError('core.malformed_request', { message });
}

/** How deep variables may nest: far deeper than any input type of a real surface, far shallower than the stack of a recursive coercion. */
const maxVariableDepth = 64;

/** Whether a JSON value nests deeper than `limit` levels; walks with its own stack, so no depth can overflow it. */
function nestsDeeperThan(value: unknown, limit: number): boolean {
  const pending: { readonly value: unknown; readonly depth: number }[] = [{ value, depth: 0 }];
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    if (typeof item.value !== 'object' || item.value === null) continue;
    if (item.depth + 1 > limit) return true;
    for (const member of Object.values(item.value)) {
      pending.push({ value: member, depth: item.depth + 1 });
    }
  }
  return false;
}

/**
 * One GraphQL request as a client sends it, the same over HTTP and graphql-ws: a `query` string (a
 * persisted operation is refused: none are served), an optional `operationName`, and `variables`
 * that are a JSON object nested at most 64 levels deep.
 */
export function graphqlParamsOf(item: unknown): GraphqlParams {
  if (!isRecord(item)) throw malformed('A GraphQL request must be a JSON object.');
  const { query, operationName, variables, extensions } = item;
  if (typeof query !== 'string') {
    const persisted = isRecord(extensions) && extensions.persistedQuery !== undefined;
    throw malformed(
      persisted
        ? 'Persisted operations are not served; send the query text.'
        : 'A GraphQL request needs a `query` string.',
    );
  }
  if (operationName !== undefined && operationName !== null && typeof operationName !== 'string') {
    throw malformed('`operationName` must be a string.');
  }
  if (variables !== undefined && variables !== null && !isRecord(variables)) {
    throw malformed('`variables` must be a JSON object.');
  }
  if (nestsDeeperThan(variables, maxVariableDepth)) {
    throw malformed(`The variables nest deeper than ${maxVariableDepth} levels.`);
  }
  return {
    query,
    ...(typeof operationName === 'string' ? { operationName } : {}),
    ...(isRecord(variables) ? { variables } : {}),
  };
}
