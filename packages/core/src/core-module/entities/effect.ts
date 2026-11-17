import { defineEntity } from '../../dsl/define-entity.ts';
import { effectStatuses } from '../../effects/effect-statuses.ts';
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
 * input with personal fields sealed and secrets as references, the command that caused it, the ids
 * of the events it accompanied, the continuation, key and deadline, and the submitter reference)
 * and the `settled` record of a later release fills `status`, `output`, `error`, `outputDigest`,
 * `attempts` and `settledAt`. Only the kernel writes it; its stream is `core.effect/<id>`. No rule
 * of the core module reads it through the API: an app that wants its effects readable adds a rule
 * of its own, and the submitter of a command follows the effects it requested through
 * `core.effectStatus` and `core.effectStatusWatch`. The effects that the inline reactions of any
 * module request while the command runs carry the submitter's reference and are shown to it (type
 * and error code included).
 */
export const effect: CoreBase['entities']['effect'] = defineEntity({
  prefix: 'eff',
  fields: {
    type: field.string(),
    commandId: field.string(),
    status: field.enum(effectStatuses),
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
    /**
     * `principalResolver` and `principalId` are the kernel's copy of the submitter reference (a
     * principal is the pair, section 8.5). Both are absent for a decision outside a command (a
     * continuation, a timer, a queued reaction, each under a minted service principal); an inline
     * reaction of any module keeps the command's submitter. They are hidden from API reads and from
     * rule conditions, and the kernel's status view (`core.effectStatus`, `core.effectStatusWatch`)
     * reads them.
     */
    principalResolver: field.string().optional().hidden(),
    principalId: field.string().optional().hidden(),
  },
  tenancy: 'invocation',
  generated: { set: false },
});
