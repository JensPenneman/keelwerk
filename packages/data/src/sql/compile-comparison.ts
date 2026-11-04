import { KeelwerkError } from '@keelwerk/core';
import { sql } from 'kysely';
import type { ComparisonCondition } from './comparison-condition.ts';
import { comparisonOperators } from './comparison-operators.ts';
import type { CompiledPredicate, ConditionContext } from './compile-condition.ts';
import { escapeLike } from './escape-like.ts';
import { falseLiteral } from './false-literal.ts';
import { malformedCondition } from './malformed-condition.ts';
import { trueLiteral } from './true-literal.ts';
import type { ValueCodec } from './value-codec.ts';
import { wrapPredicate } from './wrap-predicate.ts';

const sqlOperators = { lt: '<', lte: '<=', gt: '>', gte: '>=' } as const;

/** The marker the kernel catches to take its bounded in-memory path (S-37, section 14.3.3). */
function personalUnsupported(node: ComparisonCondition, reason: string): KeelwerkError {
  return new KeelwerkError({
    kind: 'unsupported',
    code: 'core.personal_operator',
    message: `${node.op} on the personal field ${node.field} is not available: ${reason}`,
    details: { op: node.op, field: node.field, reason },
  });
}

function encodeOperand(codec: ValueCodec, node: ComparisonCondition, value: unknown): unknown {
  try {
    return codec.encode(value);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new KeelwerkError({
        kind: 'validation',
        code: 'core.malformed_request',
        message: `the operand of ${node.op} on ${node.field} does not fit the field: ${error.message}`,
        details: { op: node.op, field: node.field },
        cause: error,
      });
    }
    throw error;
  }
}

function isAbsent(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

function operandList(node: ComparisonCondition): readonly unknown[] {
  if (!Array.isArray(node.value)) {
    throw malformedCondition(`the ${node.op} operand of ${node.field} must be an array`, {
      op: node.op,
      field: node.field,
    });
  }
  return node.value;
}

export function compileComparison(
  context: ConditionContext,
  node: ComparisonCondition,
): CompiledPredicate {
  const column = context.table.column(node.field);
  if (column === undefined) {
    throw malformedCondition(`${context.table.entity.ref} has no field ${node.field}`, {
      entity: context.table.entity.ref,
      field: node.field,
    });
  }
  const allowed = comparisonOperators(column);
  if (allowed === undefined || !allowed.has(node.op)) {
    if (column.field.personal !== false || column.derived !== undefined) {
      throw personalUnsupported(
        node,
        node.op === 'startsWith' || node.op === 'contains'
          ? 'prefix and trigram tags are not written in M1 (the kernel scans)'
          : 'the encryption planner has not rewritten it onto an index field',
      );
    }
    throw malformedCondition(
      `${node.op} is not available on ${column.field.kind} field ${node.field}`,
      {
        op: node.op,
        field: node.field,
        kind: column.field.kind,
      },
    );
  }

  const reference = sql.ref(context.table.reference(column.column));
  if (node.op === 'isNull') {
    const present: unknown = node.value;
    if (typeof present !== 'boolean') {
      throw malformedCondition(`the isNull operand of ${column.path} must be a boolean`, {
        field: column.path,
      });
    }
    return wrapPredicate(
      present ? sql<boolean>`${reference} is null` : sql<boolean>`${reference} is not null`,
      false,
    );
  }

  const codec =
    column.derived === undefined
      ? context.dialect.codecs.forField(column.field)
      : context.dialect.codecs.forDerivedIndex(column.derived);
  const arrayType = sql.raw(`${codec.sqlType}[]`);

  if (node.op === 'in' || node.op === 'nin') {
    const list = operandList(node);
    if (list.some(isAbsent)) return falseLiteral;
    if (list.length === 0) return node.op === 'in' ? falseLiteral : trueLiteral;
    const bound = list.map((value) => encodeOperand(codec, node, value));
    const member = sql<boolean>`${reference} = any(${bound}::${arrayType})`;
    return node.op === 'in'
      ? wrapPredicate(member, true)
      : wrapPredicate(sql<boolean>`(${reference} is null or not (${member}))`, false);
  }

  if (isAbsent(node.value)) return falseLiteral;

  switch (node.op) {
    case 'eq':
      return wrapPredicate(
        sql<boolean>`${reference} = ${encodeOperand(codec, node, node.value)}`,
        true,
      );
    case 'ne':
      return wrapPredicate(
        sql<boolean>`${reference} is distinct from ${encodeOperand(codec, node, node.value)}`,
        false,
      );
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte': {
      const operator = sql.raw(sqlOperators[node.op]);
      return wrapPredicate(
        sql<boolean>`(${reference} is not null and ${reference} ${operator} ${encodeOperand(codec, node, node.value)})`,
        false,
      );
    }
    case 'contains': {
      if (column.field.kind === 'set' || column.field.kind === 'list') {
        const inner =
          column.field.inner === null
            ? undefined
            : context.dialect.codecs.forField(column.field.inner);
        const element = inner === undefined ? node.value : encodeOperand(inner, node, node.value);
        return wrapPredicate(
          sql<boolean>`${reference} @> ${JSON.stringify([element])}::jsonb`,
          true,
        );
      }
      if (typeof node.value !== 'string') return falseLiteral;
      return wrapPredicate(
        sql<boolean>`${reference} like ${`%${escapeLike(node.value)}%`} escape '\\'`,
        true,
      );
    }
    case 'startsWith': {
      if (typeof node.value !== 'string') return falseLiteral;
      return wrapPredicate(
        sql<boolean>`${reference} like ${`${escapeLike(node.value)}%`} escape '\\'`,
        true,
      );
    }
  }
}
