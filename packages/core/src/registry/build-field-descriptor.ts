import type { AnyField } from '../fields/field-def.ts';
import type { PersonalOptions } from '../fields/personal-options.ts';
import type { FieldConstraints } from '../storage/field-constraints.ts';
import type { FieldDescriptor } from '../storage/field-descriptor.ts';
import type { NormalizerRef } from '../storage/normalizer-ref.ts';
import type { PersonalParams } from '../storage/personal-params.ts';
import { physicalColumnName } from '../storage/physical-column-name.ts';
import { referenceTarget } from './reference-target.ts';

function compact(entries: Readonly<Record<string, unknown>>): FieldConstraints {
  return Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value !== undefined),
  ) as FieldConstraints;
}

function constraintsOf(def: AnyField): FieldConstraints {
  const options = def.options as Readonly<Record<string, unknown>> | readonly string[] | undefined;
  if (options === undefined || def.kind === 'json') return {};
  if (Array.isArray(options)) return def.kind === 'enum' ? { values: options as string[] } : {};
  const named = options as Readonly<Record<string, unknown>>;
  switch (def.kind) {
    case 'string':
    case 'text':
      return compact({
        maxLength: named.maxLength,
        minLength: named.minLength,
        pattern: named.pattern,
        format: named.format,
      });
    case 'integer':
      return compact({ min: named.min, max: named.max, wide: named.wide });
    case 'decimal':
      return compact({ precision: named.precision, scale: named.scale });
    case 'serial':
      return compact({ per: named.per });
    default:
      return {};
  }
}

function normalizerOf(def: AnyField, options: PersonalOptions): NormalizerRef {
  const declared = options.normalize;
  if (declared === undefined) {
    return { id: def.kind === 'string' || def.kind === 'text' ? 'nfc' : 'exact', version: 1 };
  }
  return typeof declared === 'string'
    ? { id: declared, version: 1 }
    : { id: declared.id, version: declared.version };
}

function paramsOf(options: PersonalOptions): PersonalParams {
  return {
    eq: { bits: options.eq?.bits ?? 128 },
    prefix: { min: options.prefix?.min ?? 3, max: options.prefix?.max ?? 32 },
    contains: { bits: options.contains?.bits ?? 12 },
    order: { bytes: options.order?.bytes ?? 16 },
  };
}

function personalOf(def: AnyField, context: FieldContext): FieldDescriptor['personal'] {
  const flag = def.flags.personal;
  if (flag === false) return false;
  const options = def.personalOptions ?? {};
  return {
    subject: flag.subject ?? context.dataSubject ?? 'id',
    queries: flag.queries,
    normalize: normalizerOf(def, options),
    params: paramsOf(options),
    keys: options.keys ?? 'tenant',
  };
}

function mergeOf(def: AnyField): FieldDescriptor['merge'] {
  const declared = def.flags.merge;
  if (declared === null) return def.kind === 'set' ? 'set' : 'lww';
  return declared;
}

/** What a field descriptor needs to know of the entity it sits in. */
export interface FieldContext {
  /** The module whose `own` references the field resolves against. */
  readonly declaredBy: string;
  /** The entity's data subject: the default subject of its personal fields. */
  readonly dataSubject: string | null;
  /** The tag the field takes when it declares none. */
  readonly tag: number;
  /** Whether a database foreign key can enforce a reference to this entity (same scope). */
  readonly foreignKeyTo: (entityRef: string) => boolean;
}

/**
 * The adapter's view of one field (section 14.3.2): the column is the snake-case of the name
 * (S-59, decision 55b), the flags are carried over, and a tag is allocated when none is declared.
 */
export function buildFieldDescriptor(
  name: string,
  def: AnyField,
  context: FieldContext,
): FieldDescriptor {
  const target = referenceTarget(def.ref, context.declaredBy);
  const targetRef = target === null ? null : `${target.module}.${target.entity}`;
  const sequence = def.flags.merge === 'sequence' || def.flags.merge === 'richText';
  return {
    kind: def.kind,
    column: name === '' ? '' : physicalColumnName(name),
    optional: def.flags.optional,
    unique: def.flags.unique,
    indexed: def.flags.indexed,
    hidden: def.flags.hidden ? { history: false } : false,
    maskable: def.flags.maskable,
    stateOnly: def.flags.stateOnly,
    sealed: def.kind === 'secret' || def.kind === 'verifier',
    merge: mergeOf(def),
    personal: personalOf(def, context),
    constraints: constraintsOf(def),
    ref:
      targetRef === null
        ? null
        : { entity: targetRef, foreignKey: context.foreignKeyTo(targetRef) },
    inner: def.inner === null ? null : buildFieldDescriptor('', def.inner, context),
    codec: sequence || def.kind === 'richText' ? 'loro/1' : null,
    tag: def.flags.tag ?? context.tag,
  };
}
