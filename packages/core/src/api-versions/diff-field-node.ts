import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { FieldNode } from '../surface/field-node.ts';
import type { JsonSchema } from '../surface/json-schema.ts';
import type { SurfaceChangeKind } from './surface-change.ts';

type Side = 'input' | 'output';

const unionKeys = ['anyOf', 'oneOf'] as const;

function same(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

/** Output schemas that differ only by members added to an `anyOf` or `oneOf` list. */
function onlyMembersAdded(base: JsonSchema, head: JsonSchema): boolean {
  for (const key of unionKeys) {
    const before = base[key];
    const after = head[key];
    if (!(Array.isArray(before) && Array.isArray(after)) || after.length <= before.length) continue;
    const kept = new Set(after.map((member) => canonicalizeJson(member)));
    if (!before.every((member) => kept.has(canonicalizeJson(member)))) continue;
    const { [key]: _base, ...baseRest } = base;
    const { [key]: _head, ...headRest } = head;
    if (same(baseRest, headRest)) return true;
  }
  return false;
}

type Bound = 'same' | 'narrower' | 'wider';

/** A lower (`min`) or upper (`max`) bound; a bound that appears narrows, one that goes widens. */
function boundChange(
  before: number | string | undefined,
  after: number | string | undefined,
  side: 'min' | 'max',
): Bound {
  if (before === after) return 'same';
  if (before === undefined) return 'narrower';
  if (after === undefined) return 'wider';
  if (Number(after) === Number(before)) return 'same';
  return Number(after) > Number(before) === (side === 'min') ? 'narrower' : 'wider';
}

function constraintChanges(base: FieldNode, head: FieldNode): readonly Bound[] {
  if ((base.kind === 'string' || base.kind === 'text') && base.kind === head.kind) {
    return [
      boundChange(base.minLength, head.minLength, 'min'),
      boundChange(base.maxLength, head.maxLength, 'max'),
      base.pattern === head.pattern ? 'same' : head.pattern === undefined ? 'wider' : 'narrower',
      base.format === head.format ? 'same' : head.format === undefined ? 'wider' : 'narrower',
    ];
  }
  if (base.kind === 'integer' && head.kind === 'integer') {
    return [boundChange(base.min, head.min, 'min'), boundChange(base.max, head.max, 'max')];
  }
  if (base.kind === 'decimal' && head.kind === 'decimal') {
    return [
      boundChange(base.min, head.min, 'min'),
      boundChange(base.max, head.max, 'max'),
      boundChange(base.precision, head.precision, 'max'),
      boundChange(base.scale, head.scale, 'max'),
    ];
  }
  return [];
}

function schemaOf(node: FieldNode, side: Side): unknown {
  if (node.kind === 'json') return (side === 'input' ? node.input : node.output) ?? node.schema;
  if (node.kind === 'foreign') return node[side];
  return undefined;
}

/** The differences between the fields of two shapes. */
function diffShape(
  base: Readonly<Record<string, FieldNode>>,
  head: Readonly<Record<string, FieldNode>>,
  side: Side,
  path: string,
): readonly NodeDifference[] {
  const found: NodeDifference[] = [];
  const names = [...new Set([...Object.keys(base), ...Object.keys(head)])].toSorted();
  for (const name of names) {
    const at = path === '' ? name : `${path}.${name}`;
    const before = base[name];
    const after = head[name];
    if (before !== undefined && after !== undefined) {
      found.push(...diffFieldNode(before, after, side, at));
    } else if (before !== undefined) {
      found.push(
        side === 'output'
          ? { kind: 'outputFieldRemoved', path: at, message: 'The output field was removed.' }
          : { kind: 'inputFieldRemoved', path: at, message: 'The input field was removed.' },
      );
    } else if (after !== undefined) {
      const required = !after.optional && after.default === undefined;
      found.push(
        side === 'output'
          ? { kind: 'outputFieldAdded', path: at, message: 'An output field was added.' }
          : {
              kind: required ? 'inputRequiredFieldAdded' : 'inputOptionalFieldAdded',
              path: at,
              message: required
                ? 'A required input field was added.'
                : 'An optional input field was added.',
            },
      );
    }
  }
  return found;
}

/** One difference found inside a field node, at a path below the action, entity or event. */
export interface NodeDifference {
  readonly kind: SurfaceChangeKind;
  readonly path: string;
  readonly message: string;
}

/**
 * The differences between two field nodes of one input or output, by path. Output fields are what
 * clients read, input fields what they send; a schema the node cannot describe structurally
 * (`json`, `foreign`) is compared whole.
 */
export function diffFieldNode(
  base: FieldNode,
  head: FieldNode,
  side: Side,
  path: string,
): readonly NodeDifference[] {
  const found: NodeDifference[] = [];
  const add = (kind: SurfaceChangeKind, message: string, at = path): void => {
    found.push({ kind, path: at, message });
  };
  // A client may leave an input field out when it is optional or has a default.
  const omittable = (node: FieldNode): boolean =>
    side === 'input' ? node.optional || node.default !== undefined : node.optional;
  if (omittable(base) !== omittable(head)) {
    const optional = omittable(head);
    if (side === 'output') {
      add(
        optional ? 'outputMadeOptional' : 'outputMadeRequired',
        optional ? 'The output field became optional.' : 'The output field became required.',
      );
    } else {
      add(
        optional ? 'inputMadeOptional' : 'inputMadeRequired',
        optional ? 'The input field became optional.' : 'The input field became required.',
      );
    }
  }
  if (side === 'output' && head.access === 'write' && base.access !== 'write') {
    add('outputFieldRemoved', 'The output field is no longer readable.');
  }
  if (base.kind !== head.kind) {
    add(
      side === 'output' ? 'outputTypeChanged' : 'inputTypeChanged',
      `The ${side} type changed from ${base.kind} to ${head.kind}.`,
    );
    return found;
  }
  const typeChanged = (): void =>
    add(
      side === 'output' ? 'outputTypeChanged' : 'inputTypeChanged',
      `The ${side} type ${base.kind} changed.`,
    );
  switch (base.kind) {
    case 'enum': {
      const headValues = head.kind === 'enum' ? head.values : [];
      for (const value of headValues.filter((item) => !base.values.includes(item))) {
        add(
          side === 'output' ? 'outputEnumValueAdded' : 'inputEnumValueAdded',
          `The ${side} enum gained '${value}'.`,
        );
      }
      for (const value of base.values.filter((item) => !headValues.includes(item))) {
        add(
          side === 'output' ? 'outputEnumValueRemoved' : 'inputEnumValueRemoved',
          `The ${side} enum lost '${value}'.`,
        );
      }
      break;
    }
    case 'id':
    case 'ref':
      if (head.kind === base.kind && (head.target !== base.target || head.prefix !== base.prefix)) {
        typeChanged();
      }
      break;
    case 'serial':
      if (head.kind === 'serial' && !same(base.per, head.per)) typeChanged();
      break;
    case 'list':
    case 'set':
    case 'page':
      if (head.kind === base.kind) {
        found.push(...diffFieldNode(base.item, head.item, side, `${path}[]`));
      }
      break;
    case 'shape':
      if (head.kind === 'shape') {
        found.push(...diffShape(base.fields, head.fields, side, path));
      }
      break;
    case 'json':
    case 'foreign': {
      const before = schemaOf(base, side);
      const after = schemaOf(head, side);
      if (same(before, after)) break;
      const isObject = (value: unknown): value is JsonSchema =>
        typeof value === 'object' && value !== null;
      if (
        side === 'output' &&
        isObject(before) &&
        isObject(after) &&
        onlyMembersAdded(before, after)
      ) {
        add('outputUnionMemberAdded', 'The output schema gained a union member.');
      } else {
        add(
          side === 'output' ? 'outputSchemaChanged' : 'inputSchemaChanged',
          `The ${side} schema changed.`,
        );
      }
      break;
    }
    default: {
      if (base.kind === 'integer' && head.kind === 'integer' && base.wide !== head.wide) {
        // A wide integer is a string on the wire, so the change is a new type both ways.
        typeChanged();
        break;
      }
      if (side === 'input') {
        const bounds = constraintChanges(base, head);
        if (bounds.includes('narrower')) {
          add('inputTypeNarrowed', 'The input constraints narrowed.');
        } else if (bounds.includes('wider')) {
          add('inputTypeWidened', 'The input constraints widened.');
        }
      }
    }
  }
  return found;
}
