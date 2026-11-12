import type { StandardSchemaV1 } from '@keelwerk/core';
import { defineSubscription, field, pokesSourceOf, shape } from '@keelwerk/core';
import { liveBase } from '../live-base.ts';

/** The state token of each entity type a poke names: a record of strings. */
const standard = {
  version: 1 as const,
  vendor: 'keelwerk',
  validate: (value: unknown) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { issues: [{ message: 'Expected an object of state tokens.' }] };
    }
    const tokens: Record<string, string> = {};
    for (const [entity, token] of Object.entries(value)) {
      if (typeof token !== 'string') {
        return { issues: [{ message: `The state token of "${entity}" must be a string.` }] };
      }
      tokens[entity] = token;
    }
    return { value: tokens };
  },
  jsonSchema: {
    input: () => ({ type: 'object', additionalProperties: { type: 'string' } }),
    output: () => ({ type: 'object', additionalProperties: { type: 'string' } }),
  },
};

const stateTokenMap: StandardSchemaV1<Record<string, string>, Record<string, string>> = {
  '~standard': standard,
};

/** `live.pokes` (15.4.1): the new state token of each entity type the caller may read, per changed batch of its scope. */
export const pokesAction = defineSubscription(liveBase, {
  event: shape({
    upto: field.string(),
    changed: field.json(stateTokenMap),
    partition: field.string().optional(),
  }),
  principal: 'user',
  source: () => pokesSourceOf(),
});
