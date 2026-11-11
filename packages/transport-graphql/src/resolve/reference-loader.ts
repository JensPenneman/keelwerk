import { errors } from '@keelwerk/core';
import DataLoader from 'dataloader';
import { graphqlErrorOf } from '../errors/graphql-error-of.ts';
import { projectedGetOf } from '../schema/projected-get-of.ts';
import { encodeOutput } from './encode-output.ts';
import type { GraphqlContext } from './graphql-context.ts';
import { invokeAction } from './invoke-action.ts';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const largestBatch = 100;

/**
 * The batch function of one target entity: every id asked for in one execution level becomes one
 * `<target>.get` through the invoker with the request's own session (section 16.6.2). It answers
 * the encoded rows in key order and `null` for an id the caller may not see or that does not
 * exist; a failed `get` rejects every key, so each reference field carries its own error. The
 * loader belongs to one request: its cache dies with it. A batch never holds more ids than the
 * target's page `maxSize`, which is what the generated `get` accepts.
 */
export function referenceLoader(
  context: GraphqlContext,
  entity: string,
): DataLoader<string, unknown> {
  const target = context.surface.entities.find((candidate) => candidate.ref === entity);
  return new DataLoader<string, unknown>(
    async (ids) => {
      const get = projectedGetOf(context.surface, entity);
      if (get === undefined) {
        throw graphqlErrorOf(errors.internal(`The entity ${entity} has no get action.`), context);
      }
      const outcome = await invokeAction(context, get, { ids: [...ids] });
      if (!outcome.ok) {
        throw graphqlErrorOf(outcome.error, context);
      }
      const encoded = encodeOutput(context, get, outcome.value);
      const list = isRecord(encoded) && Array.isArray(encoded.list) ? encoded.list : [];
      const byId = new Map<string, unknown>();
      for (const row of list) {
        if (isRecord(row) && typeof row.id === 'string') byId.set(row.id, row);
      }
      return ids.map((id) => byId.get(id) ?? null);
    },
    { maxBatchSize: Math.min(largestBatch, target?.page.maxSize ?? largestBatch) },
  );
}
