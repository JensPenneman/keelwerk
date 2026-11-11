import { isPlainRecord } from '../api-versions/is-plain-record.ts';
import type { StandardIssue, StandardResult } from '../fields/standard-schema-v1.ts';
import type { FieldNode } from '../surface/field-node.ts';
import type { SurfaceEntity } from '../surface/surface-entity.ts';
import { mapFilter } from './map-filter.ts';

type Path = readonly (string | number)[];

const valueOperators: ReadonlySet<string> = new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte']);
const listOperators: ReadonlySet<string> = new Set(['in', 'nin']);
const notForIds = 'is not an operator of a field that holds an id';

function holdsId(node: FieldNode): boolean {
  if (node.kind === 'id' || node.kind === 'ref') return true;
  return (node.kind === 'list' || node.kind === 'set') && holdsId(node.item);
}

/**
 * Converts the id operands of a filter of `entity` (the walk of `mapFilter`): every operand that
 * compares a value of a field holding an id (kind `id` or `ref`, or a list or set of them) goes
 * through `convert` with the field node, `eq`, `ne`, `lt`, `lte`, `gt`, `gte` and each item of
 * `in` and `nin` with the node of the field, `contains` on a list or set with its item node, and
 * a bare operand as `eq`. `startsWith` and `contains` on a field that is no collection compare the
 * stored form, which the wire never shows: they are refused at `[..., field, operator]`. Other
 * operators and fields are left as they are (the pipeline refuses unknown ones). Answers the filter
 * with converted operands, or every issue, paths starting with `at`. A filter over the bounds of
 * `mapFilter` throws its `FilterLimitError`.
 */
export function convertFilter(
  filter: unknown,
  entity: SurfaceEntity,
  entityOf: (ref: string) => SurfaceEntity | undefined,
  convert: (node: FieldNode, value: unknown) => StandardResult<unknown>,
  at: Path = [],
): StandardResult<unknown> {
  const issues: StandardIssue[] = [];
  const operand = (node: FieldNode, value: unknown, path: Path): unknown => {
    if (value === null || value === undefined) return value;
    const result = convert(node, value);
    if (result.issues === undefined) return result.value;
    issues.push(
      ...result.issues.map((issue) => ({ ...issue, path: [...path, ...(issue.path ?? [])] })),
    );
    return value;
  };
  const operators = (
    node: FieldNode,
    value: Readonly<Record<string, unknown>>,
    path: Path,
  ): unknown => {
    let changed = false;
    const out: [string, unknown][] = [];
    for (const [op, given] of Object.entries(value)) {
      const here = [...path, op];
      let next = given;
      if (valueOperators.has(op)) {
        next = operand(node, given, here);
      } else if (listOperators.has(op) && Array.isArray(given)) {
        next = (given as unknown[]).map((item, index) => operand(node, item, [...here, index]));
        if (!(next as unknown[]).some((item, index) => item !== given[index])) next = given;
      } else if (op === 'contains' && (node.kind === 'list' || node.kind === 'set')) {
        next = operand(node.item, given, here);
      } else if (op === 'startsWith' || op === 'contains') {
        issues.push({ message: notForIds, path: here });
      }
      if (next !== given) changed = true;
      out.push([op, next]);
    }
    return changed ? Object.fromEntries(out) : value;
  };
  const targetOf = (ref: string, relation: string): string | undefined => {
    const relations = entityOf(ref)?.relations;
    return relations !== undefined && Object.hasOwn(relations, relation)
      ? relations[relation]?.target
      : undefined;
  };
  const converted = mapFilter(
    filter,
    entity.ref,
    targetOf,
    (field) => {
      const fields = entityOf(field.entity)?.fields;
      const node =
        fields !== undefined && Object.hasOwn(fields, field.key) ? fields[field.key] : undefined;
      if (
        node === undefined ||
        !holdsId(node) ||
        field.value === null ||
        field.value === undefined
      ) {
        return { name: field.key, value: field.value };
      }
      return {
        name: field.key,
        value: isPlainRecord(field.value)
          ? operators(node, field.value, field.path)
          : operand(node, field.value, field.path),
      };
    },
    at,
  );
  return issues.length > 0 ? { issues } : { value: converted };
}
