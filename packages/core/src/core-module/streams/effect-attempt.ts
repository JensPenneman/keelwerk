import { defineStream } from '../../dsl/define-stream.ts';
import type { EffectAttemptError } from '../../effects/effect-attempt-error.ts';
import type { ErrorKind } from '../../errors/error-kind.ts';
import { isErrorCode } from '../../errors/is-error-code.ts';
import { field } from '../../fields/field.ts';
import { shape } from '../../fields/shape.ts';
import type { StandardSchemaV1 } from '../../fields/standard-schema-v1.ts';
import type { CoreBase } from '../core-base-type.ts';

const kinds: ReadonlySet<string> = new Set<ErrorKind>([
  'validation',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'not_implemented',
  'unavailable',
  'unsupported',
  'internal',
]);

/** A request id as the invoker mints it: a UUID in its canonical lower-case form. */
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const members = new Set(['kind', 'code', 'retryable', 'retryAfter', 'requestId']);

function check(value: unknown): { value: EffectAttemptError } | { issues: { message: string }[] } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { issues: [{ message: 'Expected an object.' }] };
  }
  const issues: { message: string }[] = [];
  const given = value as Readonly<Record<string, unknown>>;
  for (const name of Object.keys(given)) {
    if (!members.has(name)) {
      issues.push({ message: `"${name}" is not kept: an attempt keeps the code and status only.` });
    }
  }
  if (typeof given.kind !== 'string' || !kinds.has(given.kind)) {
    issues.push({ message: '"kind" must be an error kind.' });
  }
  if (typeof given.code !== 'string' || !isErrorCode(given.code)) {
    issues.push({ message: '"code" must be a registered stable error code, never free text.' });
  }
  if (typeof given.retryable !== 'boolean')
    issues.push({ message: '"retryable" must be a boolean.' });
  if (given.retryAfter !== undefined && typeof given.retryAfter !== 'number') {
    issues.push({ message: '"retryAfter" must be a number of seconds.' });
  }
  if (typeof given.requestId !== 'string' || !requestIdPattern.test(given.requestId)) {
    issues.push({ message: '"requestId" must be a request id (a UUID), never free text.' });
  }
  return issues.length > 0 ? { issues } : { value: given as unknown as EffectAttemptError };
}

const standard = {
  version: 1 as const,
  vendor: 'keelwerk',
  validate: check,
  jsonSchema: {
    input: () => ({ type: 'object' }),
    output: () => ({ type: 'object' }),
  },
};

/** Exactly the members of `EffectAttemptError`: a full wire error is refused, so no message reaches the stream. */
const attemptErrorSchema: StandardSchemaV1<EffectAttemptError, EffectAttemptError> = {
  '~standard': standard,
};

/**
 * The stream `core.effectAttempt` (section 7.9.6): one record per attempt to run an effect,
 * keyed by the effect's id. Operators read it as they read `core.effect`; it has no retention, so
 * the records are kept. A failed attempt keeps the error's kind, code, retry flag, wait and
 * request id only: the full error, which may quote personal data, stays in `core.effect.error`,
 * where it is sealed with the effect's input.
 */
export const effectAttempt: CoreBase['streams']['effectAttempt'] = defineStream({
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
