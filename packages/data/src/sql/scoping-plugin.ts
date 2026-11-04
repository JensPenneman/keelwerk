import type { StorageScope } from '@keelwerk/core';
import type {
  DeleteQueryNode,
  InsertQueryNode,
  JoinNode,
  KyselyPlugin,
  OperationNode,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  RootOperationNode,
  SelectQueryNode,
  UnknownRow,
  UpdateQueryNode,
  WithNode,
} from 'kysely';
import {
  AndNode,
  JoinNode as JoinNodes,
  OnNode,
  OperationNodeTransformer,
  ParensNode,
  TableNode,
  WhereNode,
} from 'kysely';
import { checkScopeAssignment } from './check-scope-assignment.ts';
import { predicateKey } from './predicate-key.ts';
import type { ScopeColumn } from './scope-column.ts';
import { scopeConjunction } from './scope-conjunction.ts';
import { scopeForbidden } from './scope-forbidden.ts';
import { scopeKey } from './scope-key.ts';
import { scopePredicate } from './scope-predicate.ts';
import { scopedInsertValues } from './scoped-insert-values.ts';
import { tableOf } from './table-of.ts';
import { withoutWith } from './without-with.ts';

type Statement = SelectQueryNode | InsertQueryNode | UpdateQueryNode | DeleteQueryNode;

class ScopingTransformer extends OperationNodeTransformer {
  readonly #scope: StorageScope;
  readonly #scoped: ReadonlyMap<string, ScopeColumn>;
  readonly #unscoped: ReadonlySet<string>;
  readonly #deploymentId: string | undefined;
  #visible: ReadonlySet<string> = new Set();

  constructor(
    scope: StorageScope,
    scoped: ReadonlyMap<string, ScopeColumn>,
    unscoped: ReadonlySet<string>,
    deploymentId: string | undefined,
  ) {
    super();
    this.#scope = scope;
    this.#scoped = scoped;
    this.#unscoped = unscoped;
    this.#deploymentId = deploymentId;
  }

  /** The scope column of a table reference and the value the unit gives it; nothing for an open or unscoped table. */
  #scopeOf(table: TableNode): { readonly column: ScopeColumn; readonly value: string } | undefined {
    const scope = this.#scope;
    if (scope.level === 'namespace') return undefined;
    const schema = table.table.schema?.name;
    const name = table.table.identifier.name;
    if (schema === undefined && this.#visible.has(name)) return undefined;
    const column = this.#scoped.get(scopeKey(schema, name));
    if (column === undefined) {
      if (this.#unscoped.has(scopeKey(schema, name))) return undefined;
      throw scopeForbidden(
        `the table ${scopeKey(schema, name)} is not part of this unit's namespace`,
        {
          table: scopeKey(schema, name),
        },
      );
    }
    const value = this.#valueOf(column);
    if (value === undefined) {
      throw scopeForbidden(`a ${scope.level} unit may not touch ${scopeKey(schema, name)}`, {
        table: scopeKey(schema, name),
        scope: scope.level,
      });
    }
    return { column, value };
  }

  /** What the unit's scope puts in a scope column; `scope_id` holds the id of whichever scope the unit has. */
  #valueOf(column: ScopeColumn): string | undefined {
    const scope = this.#scope;
    switch (scope.level) {
      case 'tenant':
        return column === 'tenant_id' || column === 'scope_id' ? scope.tenantId : undefined;
      case 'backend':
        return column === 'backend_id' || column === 'scope_id' ? scope.backendId : undefined;
      case 'deployment':
        return column === 'scope_id' ? this.#deploymentId : undefined;
      default:
        return undefined;
    }
  }

  #predicates(items: readonly OperationNode[]): OperationNode[] {
    const found: OperationNode[] = [];
    for (const item of items) {
      const named = tableOf(item);
      if (named === 'opaque') {
        if (this.#scope.level !== 'namespace')
          throw scopeForbidden('a raw table source cannot be scoped', {});
        continue;
      }
      const scope = named === undefined ? undefined : this.#scopeOf(named.table);
      if (named === undefined || scope === undefined) continue;
      found.push(
        scopePredicate(
          scope.column,
          named.alias === undefined ? named.table : TableNode.create(named.alias),
          scope.value,
        ),
      );
    }
    return found;
  }

  #where(existing: WhereNode | undefined, items: readonly OperationNode[]): WhereNode | undefined {
    // A statement that went through the plugin before (a builder embedded in another one) already
    // demands its predicates; adding them again would only repeat them.
    const present = existing === undefined ? new Set<string>() : scopeConjunction(existing.where);
    const predicates = this.#predicates(items).filter((p) => !present.has(predicateKey(p) ?? ''));
    // The existing filter goes in parentheses: a raw `a or b` must not swallow the scope.
    let combined: OperationNode | undefined = existing && ParensNode.create(existing.where);
    for (const predicate of predicates) {
      combined = combined === undefined ? predicate : AndNode.create(combined, predicate);
    }
    return predicates.length === 0 ? existing : WhereNode.create(combined as OperationNode);
  }

  #joins(joins: readonly JoinNode[] | undefined): readonly JoinNode[] | undefined {
    // The predicate goes into ON, so an outer join stays an outer join. A join built with `orOn`
    // or a raw `a or b` keeps its own grouping: the existing condition goes in parentheses.
    return joins?.map((join) => {
      const present = join.on === undefined ? new Set<string>() : scopeConjunction(join.on.on);
      const predicates = this.#predicates([join.table]).filter(
        (p) => !present.has(predicateKey(p) ?? ''),
      );
      const [first, ...rest] = predicates;
      if (first === undefined) return join;
      const added = rest.reduce<OperationNode>((a, b) => AndNode.create(a, b), first);
      if (join.on === undefined) return JoinNodes.cloneWithOn(join, added);
      const existing = join.on.on;
      // A comparison or a parenthesised group needs no more grouping; anything else may hold an `or`.
      const grouped =
        existing.kind === 'ParensNode' || existing.kind === 'BinaryOperationNode'
          ? existing
          : ParensNode.create(existing);
      return { ...join, on: OnNode.create(AndNode.create(grouped, added)) };
    });
  }

  #checkAssignment(
    target: OperationNode | undefined,
    column: OperationNode,
    value: OperationNode,
  ): void {
    const named = target === undefined ? undefined : tableOf(target);
    if (named === undefined || named === 'opaque') return;
    const scope = this.#scopeOf(named.table);
    if (scope !== undefined) checkScopeAssignment(scope, column, value);
  }

  #insertValues(node: InsertQueryNode, into: TableNode): InsertQueryNode {
    const scope = this.#scopeOf(into);
    return scope === undefined ? node : scopedInsertValues(node, into, scope);
  }

  /** Runs `run` with the statement's CTE names visible, then puts the CTEs back on the result. */
  #statement<T extends Statement>(node: T, run: (inner: T) => T): T {
    const saved = this.#visible;
    // A refused statement must not leave its CTE names visible to the next one.
    try {
      let transformedWith: WithNode | undefined;
      if (node.with !== undefined) {
        const names = new Set(saved);
        const recursive = node.with.recursive === true;
        const expressions = node.with.expressions.map((expression) => {
          const name = expression.name.table.table.identifier.name;
          // A plain definition names the real table inside itself; only a recursive one sees its name.
          if (recursive) names.add(name);
          this.#visible = names;
          const transformed = this.transformNode(expression.expression);
          names.add(name);
          return { ...expression, expression: transformed };
        });
        transformedWith = { ...node.with, expressions };
        this.#visible = names;
      }
      const result = run(transformedWith === undefined ? node : withoutWith(node));
      return transformedWith === undefined ? result : ({ ...result, with: transformedWith } as T);
    } finally {
      this.#visible = saved;
    }
  }

  protected override transformSelectQuery(node: SelectQueryNode): SelectQueryNode {
    return this.#statement(node, (inner) => {
      const done = super.transformSelectQuery(inner);
      const where = this.#where(done.where, done.from?.froms ?? []);
      const joins = this.#joins(done.joins);
      return { ...done, ...(where && { where }), ...(joins && { joins }) };
    });
  }

  protected override transformUpdateQuery(node: UpdateQueryNode): UpdateQueryNode {
    return this.#statement(node, (inner) => {
      const done = super.transformUpdateQuery(inner);
      for (const update of done.updates ?? [])
        this.#checkAssignment(done.table, update.column, update.value);
      const where = this.#where(done.where, [
        ...(done.table ? [done.table] : []),
        ...(done.from?.froms ?? []),
      ]);
      const joins = this.#joins(done.joins);
      return { ...done, ...(where && { where }), ...(joins && { joins }) };
    });
  }

  protected override transformDeleteQuery(node: DeleteQueryNode): DeleteQueryNode {
    return this.#statement(node, (inner) => {
      const done = super.transformDeleteQuery(inner);
      const where = this.#where(done.where, [...done.from.froms, ...(done.using?.tables ?? [])]);
      const joins = this.#joins(done.joins);
      return { ...done, ...(where && { where }), ...(joins && { joins }) };
    });
  }

  protected override transformInsertQuery(node: InsertQueryNode): InsertQueryNode {
    return this.#statement(node, (inner) => {
      const done = super.transformInsertQuery(inner);
      return done.into === undefined ? done : this.#insertValues(done, done.into);
    });
  }

  /** Root statements other than the four the plugin scopes cannot be inspected. */
  checkRoot(node: RootOperationNode): void {
    const scoped = ['SelectQueryNode', 'InsertQueryNode', 'UpdateQueryNode', 'DeleteQueryNode'];
    if (this.#scope.level !== 'namespace' && !scoped.includes(node.kind)) {
      throw scopeForbidden(`a ${node.kind} cannot run in a ${this.#scope.level} unit`, {
        statement: node.kind,
      });
    }
  }
}

/** A table whose rows carry a scope column. */
export interface ScopedTable {
  readonly schema: string | null;
  readonly name: string;
  readonly column: ScopeColumn;
}

/** What the plugin enforces: the unit's scope over the tables of its namespace. */
export interface ScopingOptions {
  readonly scope: StorageScope;
  /** Every table with a scope column. */
  readonly scoped: readonly ScopedTable[];
  /** Tables a statement may use without a scope (deployment-level ones). */
  readonly unscoped?: readonly { readonly schema: string | null; readonly name: string }[];
  /** The deployment's id: what `scope_id` holds for a deployment unit (the control root). */
  readonly deploymentId?: string;
}

/**
 * The scoping plugin (sections 14.3.8, 14.4.3): every table reference in a select, update or
 * delete gets `<scope column> = <the unit's id>` in WHERE (in ON for a join), in every subquery
 * and CTE too; an insert gets the scope value, and a row carrying another one is an error, as is
 * an update that moves a row to another scope. A tenant unit reaches tables keyed by `tenant_id` and a
 * backend unit tables keyed by `backend_id`, and either reaches the framework tables keyed by
 * `scope_id` (its own tenant or backend id; a deployment unit uses the deployment id); a table that is neither scoped nor listed as unscoped, a raw
 * table source and any statement other than the four are refused. Namespace units (migrations,
 * maintenance) pass through. Raw SQL fragments inside expressions cannot be inspected: they
 * belong to the compilers of this package and to hatch calls that name a reason.
 */
export class ScopingPlugin implements KyselyPlugin {
  readonly #transformer: ScopingTransformer;

  constructor(options: ScopingOptions) {
    this.#transformer = new ScopingTransformer(
      options.scope,
      new Map(options.scoped.map((table) => [scopeKey(table.schema, table.name), table.column])),
      new Set((options.unscoped ?? []).map((table) => scopeKey(table.schema, table.name))),
      options.deploymentId,
    );
  }

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    this.#transformer.checkRoot(args.node);
    return this.#transformer.transformNode(args.node, args.queryId);
  }

  transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return Promise.resolve(args.result);
  }
}
