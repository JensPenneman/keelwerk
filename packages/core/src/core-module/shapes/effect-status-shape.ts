import type { EffectStatusError } from '../../effects/effect-status.ts';
import { isErrorCode } from '../../errors/is-error-code.ts';
import { isErrorKind } from '../../errors/is-error-kind.ts';
import { field } from '../../fields/field.ts';
import type { FieldDef, OwnRef } from '../../fields/field-def.ts';
import type { NoFlags, WithFlag } from '../../fields/field-flags.ts';
import { type Shape, shape } from '../../fields/shape.ts';
import type { StandardResult, StandardSchemaV1 } from '../../fields/standard-schema-v1.ts';

type OptionalMoment = FieldDef<
  Temporal.Instant,
  WithFlag<NoFlags, 'optional', true>,
  null,
  'instant'
>;
type OptionalError = FieldDef<EffectStatusError, WithFlag<NoFlags, 'optional', true>, null, 'json'>;

type EffectStatusFields = {
  readonly id: FieldDef<never, NoFlags, OwnRef<'effect'>, 'ref'>;
  readonly type: FieldDef<string, NoFlags, null, 'string'>;
  readonly status: FieldDef<
    'abandoned' | 'failed' | 'requested' | 'succeeded',
    NoFlags,
    null,
    'enum'
  >;
  readonly requestedAt: FieldDef<Temporal.Instant, NoFlags, null, 'instant'>;
  readonly runAt: OptionalMoment;
  readonly deadline: OptionalMoment;
  readonly settledAt: OptionalMoment;
  readonly error: OptionalError;
};

const members = new Set(['kind', 'code']);

function check(value: unknown): StandardResult<EffectStatusError> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { issues: [{ message: 'Expected an object.' }] };
  }
  const issues: { message: string }[] = [];
  for (const name of Object.keys(value)) {
    if (!members.has(name))
      issues.push({ message: `"${name}" is not shown: only the kind and code are.` });
  }
  const kind: unknown = Reflect.get(value, 'kind');
  const code: unknown = Reflect.get(value, 'code');
  if (!isErrorKind(kind)) {
    issues.push({ message: '"kind" must be an error kind.' });
    return { issues };
  }
  if (typeof code !== 'string' || !isErrorCode(code)) {
    issues.push({ message: '"code" must be a registered stable error code, never free text.' });
    return { issues };
  }
  return issues.length > 0 ? { issues } : { value: { kind, code } };
}

const errorJsonSchema = {
  type: 'object',
  required: ['kind', 'code'],
  additionalProperties: false,
  properties: { kind: { type: 'string' }, code: { type: 'string' } },
};

const standard = {
  version: 1 as const,
  vendor: 'keelwerk',
  validate: check,
  jsonSchema: { input: () => errorJsonSchema, output: () => errorJsonSchema },
};

/** Exactly the members of `EffectStatusError`: a stored error with a message or retry hint is refused, so none reaches the wire. */
const errorSchema: StandardSchemaV1<EffectStatusError, EffectStatusError> = {
  '~standard': standard,
};

/** The wire shape of `EffectStatus`, shared by `core.effectStatus` (output) and `core.effectStatusWatch` (event). */
export const effectStatusShape: Shape<EffectStatusFields> = shape({
  id: field.ref.own('effect'),
  type: field.string(),
  status: field.enum(['requested', 'succeeded', 'failed', 'abandoned']),
  requestedAt: field.instant(),
  runAt: field.instant().optional(),
  deadline: field.instant().optional(),
  settledAt: field.instant().optional(),
  error: field.json(errorSchema).optional(),
});
