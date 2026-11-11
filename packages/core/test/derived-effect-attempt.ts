import { defineStream } from '../src/dsl/define-stream.ts';
import type { EffectAttemptError } from '../src/effects/effect-attempt-error.ts';
import { field } from '../src/fields/field.ts';
import { shape } from '../src/fields/shape.ts';
import type { StandardSchemaV1 } from '../src/fields/standard-schema-v1.ts';

/** Declared, never run: this file is read by the type tests only, which compare the types the DSL derives. */
declare const attemptErrorSchema: StandardSchemaV1<EffectAttemptError, EffectAttemptError>;

/** What the DSL derives for the stream `core.effectAttempt`, which `CoreBase` must equal (decision 104). */
export const derivedEffectAttempt = defineStream({
  key: field.ref.own('effect'),
  record: shape({
    process: field.string(),
    build: field.string(),
    attempt: field.integer(),
    startedAt: field.string(),
    endedAt: field.string().optional(),
    error: field.json(attemptErrorSchema).optional(),
  }),
  readAs: 'effect',
});
