import type { Condition, EntityDescriptor, RelationDescriptor } from '@keelwerk/core';
import type { Expression } from 'kysely';
import { sql } from 'kysely';
import { compileComparison } from './compile-comparison.ts';
import type { EntityTable } from './entity-table.ts';
import { entityTable } from './entity-table.ts';
import { falseLiteral } from './false-literal.ts';
import { malformedCondition } from './malformed-condition.ts';
import { trueLiteral } from './true-literal.ts';
import type { DialectCodecs } from './value-codec.ts';
import { wrapPredicate } from './wrap-predicate.ts';

type Quantifier = Extract<Condition, { readonly relation: string }>;

function join(
  parts: readonly CompiledPredicate[],
  separator: 'and' | 'or',
  empty: CompiledPredicate,
): CompiledPredicate {
  const [only, ...rest] = parts;
  if (only === undefined) return empty;
  if (rest.length === 0) return only;
  return wrapPredicate(
    sql<boolean>`(${sql.join(
      parts.map((part) => part.expression),
      sql.raw(` ${separator} `),
    )})`,
    parts.some((part) => part.nullable),
  );
}

function negate(expression: CompiledPredicate): Expression<boolean> {
  return expression.nullable
    ? sql<boolean>`not coalesce(${expression.expression}, false)`
    : sql<boolean>`not (${expression.expression})`;
}

function steps(
  context: ConditionContext,
  node: Quantifier,
  depth: number,
): readonly QuantifierStep[] {
  const path: QuantifierStep[] = [];
  let owner = context.table;
  for (const segment of node.relation.split('.')) {
    const relation = Object.hasOwn(owner.entity.relations, segment)
      ? owner.entity.relations[segment]
      : undefined;
    if (relation === undefined) {
      throw malformedCondition(`${owner.entity.ref} has no relation ${segment}`, {
        entity: owner.entity.ref,
        relation: node.relation,
      });
    }
    const entity = context.entities(relation.target);
    if (entity === undefined) {
      throw malformedCondition(
        `the relation ${segment} of ${owner.entity.ref} targets the unknown ${relation.target}`,
        {
          entity: owner.entity.ref,
          relation: node.relation,
        },
      );
    }
    const target = entityTable(entity, context.root, `q${depth + path.length + 1}`);
    path.push({ owner, target, relation });
    owner = target;
  }
  return path;
}

function compileNode(context: ConditionContext, node: Condition, depth: number): CompiledPredicate {
  switch (node.op) {
    case 'never':
      return falseLiteral;
    case 'and':
      return join(
        node.conditions.map((inner) => compileNode(context, inner, depth)),
        'and',
        trueLiteral,
      );
    case 'or':
      return join(
        node.conditions.map((inner) => compileNode(context, inner, depth)),
        'or',
        falseLiteral,
      );
    case 'not':
      return wrapPredicate(negate(compileNode(context, node.condition, depth)), false);
    case 'some':
    case 'none':
    case 'every':
    case 'is': {
      const path = steps(context, node, depth);
      const last = path.at(-1);
      if (last === undefined)
        throw malformedCondition('a relation quantifier names no relation', {});
      const inner = compileNode(
        { ...context, table: last.target },
        node.where,
        depth + path.length,
      );
      return wrapPredicate(
        context.dialect.quantifier({ op: node.op, steps: path, predicate: inner }),
        false,
      );
    }
    default:
      return compileComparison(context, node);
  }
}

/** A compiled predicate and whether it can yield SQL `NULL` (comparisons on nullable columns can). */
export interface CompiledPredicate {
  readonly expression: Expression<boolean>;
  readonly nullable: boolean;
}

/** One hop of a relation path: the table it starts from, the table it reaches and the relation. */
export interface QuantifierStep {
  readonly owner: EntityTable;
  readonly target: EntityTable;
  readonly relation: RelationDescriptor;
}

/** What a dialect needs to write the `EXISTS` of a relation quantifier. */
export interface QuantifierRequest {
  readonly op: 'some' | 'none' | 'every' | 'is';
  /** The relation path, one step per segment of the dotted name. */
  readonly steps: readonly QuantifierStep[];
  /** The quantifier's `where`, compiled against the last step's table. */
  readonly predicate: CompiledPredicate;
}

/** Writes the `EXISTS` form of a relation quantifier (section 14.3.4). */
export type QuantifierCompiler = (request: QuantifierRequest) => Expression<boolean>;

/** The dialect-specific parts of a condition. */
export interface ConditionDialect {
  readonly codecs: DialectCodecs;
  readonly quantifier: QuantifierCompiler;
}

/** What `compileCondition` needs besides the condition. */
export interface ConditionContext {
  /** `NamespaceRef.root`. */
  readonly root: string | null;
  /** The entity the condition is about, under its alias. */
  readonly table: EntityTable;
  /** Finds the descriptor of a relation's target by entity ref. */
  readonly entities: (ref: string) => EntityDescriptor | undefined;
  readonly dialect: ConditionDialect;
}

/**
 * Compiles a condition to a PostgreSQL boolean expression that never yields `NULL` (section
 * 14.3.4): two-valued logic, null-safe `ne` and `nin`, `NOT COALESCE(p, false)` under `not`,
 * `EXISTS` for relation quantifiers with the scope predicate added by the scoping plugin. A
 * comparison the field cannot answer in SQL (the operators of 14.3.4 per kind, a personal field
 * without the capability, `startsWith` on a prefix field before M4) throws a `KeelwerkError`:
 * `unsupported` / `core.personal_operator` for personal fields, which the kernel answers with its
 * bounded in-memory path (S-37), and `validation` / `core.malformed_request` otherwise. A
 * filter is never widened.
 */
export function compileCondition(
  context: ConditionContext,
  condition: Condition,
): Expression<boolean> {
  const compiled = compileNode(context, condition, 0);
  return compiled.nullable
    ? sql<boolean>`coalesce(${compiled.expression}, false)`
    : compiled.expression;
}
