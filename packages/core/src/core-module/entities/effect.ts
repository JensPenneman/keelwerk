import { defineEntity } from '../../dsl/define-entity.ts';
import { field } from '../../fields/field.ts';
import type { StandardSchemaV1 } from '../../fields/standard-schema-v1.ts';
import type { CoreBase } from '../core-base-type.ts';

const standard = {
  version: 1 as const,
  vendor: 'keelwerk',
  validate: (value: unknown) =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? { value: { ...value } as Record<string, unknown> }
      : { issues: [{ message: 'Expected an object.' }] },
  jsonSchema: {
    input: () => ({ type: 'object' }),
    output: () => ({ type: 'object' }),
  },
};

/** The documents an effect record keeps: the input as the effect states it, the continuation's extra input, the output and the error. */
const documentSchema: StandardSchemaV1<Record<string, unknown>, Record<string, unknown>> = {
  '~standard': standard,
};

/**
 * The `core.effect` entity, the stored format of the effect record (S-26, section 7.9.6). The
 * kernel creates the row when a decision requests an external effect (`status: 'requested'`, the
 * input with personal fields sealed and secrets as references, the command that caused it, the
 * ids of the events it accompanied, the continuation, key and deadline) and the `settled` record
 * of a later release fills `status`, `output`, `error`, `outputDigest`, `attempts` and
 * `settledAt`. Only the kernel writes it; its stream is `core.effect/<id>`.
 */
export const effect: CoreBase['entities']['effect'] = defineEntity({
  prefix: 'eff',
  fields: {
    type: field.string(),
    commandId: field.string(),
    status: field.enum(['requested', 'succeeded', 'failed', 'abandoned']),
    attempts: field.integer().default(0),
    performer: field.enum(['executor', 'external']),
    input: field.json(documentSchema).optional(),
    eventIds: field.list(field.string()),
    continuation: field.string().optional(),
    continuationWith: field.json(documentSchema).optional(),
    key: field.string().optional(),
    runAt: field.instant().optional(),
    deadline: field.instant().optional(),
    output: field.json(documentSchema).optional(),
    error: field.json(documentSchema).optional(),
    outputDigest: field.string().optional(),
    settledAt: field.instant().optional(),
  },
  tenancy: 'invocation',
  generated: { set: false },
});
