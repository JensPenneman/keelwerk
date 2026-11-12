import { errors } from '../errors/errors.ts';
import type { AnyField } from '../fields/field-def.ts';
import { referenceTarget } from '../registry/reference-target.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import { resolveDataSubjectHops } from '../write-path/resolve-data-subject-hops.ts';

/** What resolving the data subject of one input member reads. */
export interface MemberSubjectInput {
  readonly unit: Unit;
  readonly registry: Registry;
  /** The module the input's references are read in. */
  readonly module: string;
  /** The validated input whose members name the subject. */
  readonly input: unknown;
  /** The input's fields, to follow a reference of a dotted path. */
  readonly fields: Readonly<Record<string, AnyField>>;
  /** Names the owner in an error, for example `the effect "x"`. */
  readonly owner: string;
}

/**
 * The subject a personal input member belongs to, found at `path` (a member of the input, or a
 * dotted path through references): `undefined` when the path resolves to nothing.
 */
export async function memberSubjectOf(
  input: MemberSubjectInput,
  path: string,
): Promise<string | undefined> {
  const [first = '', ...rest] = path.split('.');
  const plain = input.input as Readonly<Record<string, unknown>>;
  const value = Object.hasOwn(plain, first) ? plain[first] : undefined;
  if (value === undefined || value === null) return undefined;
  if (rest.length === 0) {
    if (typeof value !== 'string') {
      throw errors.internal(`${input.owner}: the data subject "${path}" is not an id`);
    }
    return value;
  }
  const head = Object.hasOwn(input.fields, first) ? input.fields[first] : undefined;
  const target = referenceTarget(head?.ref ?? null, input.module);
  if (target === null || typeof value !== 'string') return undefined;
  return resolveDataSubjectHops(
    {
      unit: input.unit,
      describe: (ref) => input.registry.entities.get(ref)?.descriptor,
    },
    `${target.module}.${target.entity}`,
    value,
    rest,
  );
}
