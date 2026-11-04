import type { AnyField } from '../fields/field-def.ts';
import type { Shape } from '../fields/shape.ts';
import { referenceTarget } from '../registry/reference-target.ts';
import { toWire } from '../wire/to-wire.ts';
import type { FieldNode } from './field-node.ts';
import type { FieldNodeBase } from './field-node-base.ts';
import type { JsonSchema } from './json-schema.ts';

type Variant = FieldNode extends infer N
  ? N extends FieldNode
    ? Omit<N, keyof FieldNodeBase>
    : never
  : never;

function isShape(value: unknown): value is Shape {
  return (
    typeof value === 'object' &&
    value !== null &&
    Reflect.get(value, 'kind') === 'shape' &&
    typeof Reflect.get(value, 'fields') === 'object'
  );
}

function jsonSchemaOf(schema: unknown, side: 'input' | 'output'): JsonSchema {
  const standard: unknown =
    typeof schema === 'object' && schema !== null ? Reflect.get(schema, '~standard') : undefined;
  const converter: unknown =
    typeof standard === 'object' && standard !== null
      ? Reflect.get(standard, 'jsonSchema')
      : undefined;
  const convert: unknown =
    typeof converter === 'object' && converter !== null ? Reflect.get(converter, side) : undefined;
  if (typeof convert !== 'function') {
    throw new TypeError(
      'the schema offers no Standard JSON Schema, so no transport could describe it',
    );
  }
  return convert.call(converter, { target: 'draft-2020-12' }) as JsonSchema;
}

/**
 * Explicit tags are kept, then the tags recorded in the module snapshot, so inserting a member
 * never renumbers the others; the remaining members take the lowest free numbers in order.
 */
function allocateTags(
  members: readonly (readonly [string, AnyField])[],
  recorded: Readonly<Record<string, number>>,
): Map<string, number> {
  const taken = new Set<number>();
  for (const [name, member] of members) {
    const known = member.flags.tag ?? recorded[name];
    if (known !== undefined) taken.add(known);
  }
  const tags = new Map<string, number>();
  let next = 1;
  for (const [name, member] of members) {
    const known = member.flags.tag ?? recorded[name];
    if (known !== undefined) {
      tags.set(name, known);
      continue;
    }
    while (taken.has(next)) next += 1;
    tags.set(name, next);
    taken.add(next);
  }
  return tags;
}

function untagged(context: FieldNodeContext): FieldNodeContext {
  return {
    declaredBy: context.declaredBy,
    tag: context.tag,
    prefixOf: context.prefixOf,
    ...(context.access === undefined ? {} : { access: context.access }),
  };
}

function variantOf(def: AnyField, context: FieldNodeContext): Variant {
  switch (def.kind) {
    case 'string':
    case 'text': {
      const options = (def.options ?? {}) as Record<string, unknown>;
      return {
        kind: def.kind,
        ...(typeof options.minLength === 'number' ? { minLength: options.minLength } : {}),
        ...(typeof options.maxLength === 'number' ? { maxLength: options.maxLength } : {}),
        ...(typeof options.pattern === 'string' ? { pattern: options.pattern } : {}),
        ...(options.format === 'email' || options.format === 'uri' || options.format === 'hostname'
          ? { format: options.format }
          : {}),
      };
    }
    case 'integer': {
      const options = (def.options ?? {}) as Record<string, unknown>;
      return {
        kind: 'integer',
        wide: options.wide === true,
        ...(typeof options.min === 'number' ? { min: options.min } : {}),
        ...(typeof options.max === 'number' ? { max: options.max } : {}),
      };
    }
    case 'serial': {
      const per = (def.options as { readonly per?: string } | undefined)?.per;
      return { kind: 'serial', per: per === undefined ? [] : [per] };
    }
    case 'decimal': {
      const options = (def.options ?? {}) as Record<string, unknown>;
      return {
        kind: 'decimal',
        ...(typeof options.precision === 'number' ? { precision: options.precision } : {}),
        ...(typeof options.scale === 'number' ? { scale: options.scale } : {}),
      };
    }
    case 'boolean':
    case 'float':
    case 'instant':
    case 'date':
    case 'timeZone':
    case 'subject':
    case 'richText':
    case 'binary':
    case 'blob':
    case 'secret':
      return { kind: def.kind };
    case 'enum':
      return { kind: 'enum', values: [...(def.options as readonly string[])] };
    case 'ref': {
      const target = referenceTarget(def.ref, context.declaredBy);
      const ref = target === null ? undefined : `${target.module}.${target.entity}`;
      const prefix = ref === undefined ? undefined : context.prefixOf(ref);
      if (ref === undefined || prefix === undefined) {
        throw new TypeError(`the reference target '${ref ?? ''}' has no TypeID prefix`);
      }
      return { kind: 'ref', target: ref, prefix };
    }
    case 'list':
    case 'set': {
      if (def.inner === null) throw new TypeError(`a ${def.kind} field needs an item field`);
      return { kind: def.kind, item: build(def.inner, context, undefined) };
    }
    case 'json': {
      if (isShape(def.options)) {
        const members = Object.entries(def.options.fields);
        const tags = allocateTags(members, context.memberTags ?? {});
        return {
          kind: 'shape',
          fields: Object.fromEntries(
            members
              .filter(([, member]) => member.kind !== 'verifier' && member.flags.hidden !== true)
              .map(([name, member]) => [name, build(member, untagged(context), tags.get(name))]),
          ),
        };
      }
      const output = jsonSchemaOf(def.options, 'output');
      return {
        kind: 'json',
        schema: output,
        input: jsonSchemaOf(def.options, 'input'),
        output,
      };
    }
    case 'verifier':
      throw new TypeError('a verifier field never appears in the surface');
    default: {
      const unknownKind: never = def.kind;
      throw new TypeError(`unknown field kind ${String(unknownKind)}`);
    }
  }
}

function build(def: AnyField, context: FieldNodeContext, tag: number | undefined): FieldNode {
  const variant = variantOf(def, context);
  const merge = def.flags.merge;
  const node: FieldNode = {
    optional: def.flags.optional,
    access:
      context.access ??
      (def.kind === 'secret' ? 'write' : def.kind === 'serial' ? 'read' : 'read-write'),
    ...(def.flags.maskable ? { maskable: true as const } : {}),
    ...(merge === null ? {} : { merge }),
    ...(def.flags.unique ? { unique: true as const } : {}),
    ...(def.flags.personal === false ? {} : { personal: true as const }),
    ...(tag === undefined ? {} : { tag: def.flags.tag ?? tag }),
    ...(def.description === null ? {} : { description: def.description }),
    ...(def.deprecation === null ? {} : { deprecated: { reason: def.deprecation } }),
    ...variant,
  };
  if (def.flags.defaulted && def.defaultValue !== undefined) {
    return { ...node, default: toWire(node, def.defaultValue) };
  }
  return node;
}

/** What `fieldNodeOf` needs to know of the place a field sits in. */
export interface FieldNodeContext {
  /** The module whose `own` references the field resolves against. */
  readonly declaredBy: string;
  /** The protobuf tag the field takes when it declares none (decision 18). */
  readonly tag: number;
  /** The TypeID prefix of an entity ('accounts.profile'), or `undefined` when unknown. */
  readonly prefixOf: (entityRef: string) => string | undefined;
  /** The tags recorded in the module snapshot for the members of a `json` shape, by member name (WP-23). */
  readonly memberTags?: Readonly<Record<string, number>>;
  /** Overrides the access: system fields are 'read'. `secret` fields default to 'write', `serial` to 'read'. */
  readonly access?: FieldNodeBase['access'];
}

/**
 * The field node of a field (section 16.2.3): kind, constraints, access, flags, the default in wire
 * form and the protobuf tag (the declared one, else `context.tag`). A `json` field over a `shape`
 * becomes a `shape` node with its members tagged in order (verifier and hidden members are left out). Throws a `TypeError` for a verifier, a
 * reference whose target has no prefix, or a schema without Standard JSON Schema.
 */
export function fieldNodeOf(def: AnyField, context: FieldNodeContext): FieldNode {
  return build(def, context, context.tag);
}
