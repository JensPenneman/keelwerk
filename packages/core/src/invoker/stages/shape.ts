import type { AuthorizedAction } from '../../authorization/authorized-action.ts';
import { checkRowInPlan } from '../../authorization/check-row-in-plan.ts';
import { createRowMatcher } from '../../authorization/create-row-matcher.ts';
import type { DroppedRow } from '../../authorization/dropped-row.ts';
import type { NormalizedRule } from '../../authorization/normalized-rule.ts';
import type { RelationAnswerer } from '../../authorization/relation-answerer.ts';
import type { RowEnvironment } from '../../authorization/row-environment.ts';
import { errors } from '../../errors/errors.ts';
import { KeelwerkError } from '../../errors/keelwerk-error.ts';
import { principalContextOf } from '../../interpreter/principal-context-of.ts';
import { refuseRequest } from '../../interpreter/refuse-request.ts';
import type { Principal } from '../../principals/principal.ts';
import type { ActionEntry } from '../../registry/action-entry.ts';
import type { EntityEntry } from '../../registry/entity-entry.ts';
import type { Registry } from '../../registry/registry.ts';
import { callerView } from '../../repositories/caller-view.ts';
import type { Scope } from '../../storage/scope.ts';
import type { StorageRow } from '../../storage/storage-row.ts';
import type { EntityOutput } from './entity-output-of.ts';
import { entityOutputOf } from './entity-output-of.ts';
import { issuesOf } from './issues-of.ts';

/** The action a row of another entity than the invoked one is planned as: the entity's generated `query`. */
function plannedAs(entry: EntityEntry, invoked: ActionEntry): AuthorizedAction {
  if (invoked.entity === entry.ref) return invoked;
  return {
    ref: `${entry.ref}.query`,
    module: entry.module,
    entity: entry.ref,
    name: 'query',
    kind: 'query',
    generated: 'query',
    instance: false,
    auth: 'policy',
    scope: entry.descriptor.tenancy === 'backend' ? 'backend' : 'tenant',
  };
}

/** The shape stage runs after the unit closed, so a relation quantifier cannot be answered: it fails closed. */
const noRelations: RelationAnswerer = (entity, node) =>
  Promise.reject(
    refuseRequest(
      `the ${node.op} on "${node.relation}" of ${entity}`,
      'the shape stage cannot answer relation quantifiers in this release',
    ),
  );

function isRow(value: unknown): value is StorageRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keeps the names an earlier mask already hid when the plan hides more. */
function mergeMasked(before: StorageRow, after: StorageRow): StorageRow {
  const earlier = before.$masked;
  const later = after.$masked;
  if (!Array.isArray(earlier) || !Array.isArray(later) || before === after) return after;
  return { ...after, $masked: [...new Set([...earlier, ...later])].sort() };
}

async function shapeRows(
  input: ShapeInput,
  entry: EntityEntry,
  rows: readonly unknown[],
): Promise<readonly StorageRow[]> {
  const list = rows.map((row) => {
    if (!isRow(row)) {
      throw new KeelwerkError({
        kind: 'internal',
        code: 'core.internal',
        message: `An entity row in the output of "${input.action.ref}" is not an object.`,
      });
    }
    return row;
  });
  const view = callerView({
    entry,
    rules: input.rules,
    action: plannedAs(entry, input.action),
    context: principalContextOf(input.registry, input.principal, input.scope),
  });
  const matches = await createRowMatcher([view.plan.where], list, {
    entity: entry.ref,
    answerer: noRelations,
  });
  const kept = list.filter((row) =>
    checkRowInPlan({
      plan: view.plan,
      row,
      environment: input.environment,
      matches,
      onDropped: input.onDropped,
    }),
  );
  const masked = await view.mask(kept, noRelations);
  return masked.map((row, index) => mergeMasked(kept[index] ?? row, row));
}

async function checkOutput(action: ActionEntry, output: unknown): Promise<void> {
  const result = await action.output['~standard'].validate(output);
  if (result.issues === undefined) return;
  throw new KeelwerkError({
    kind: 'internal',
    code: 'core.internal',
    message: `The output of "${action.ref}" does not match its schema.`,
    issues: issuesOf(result.issues),
  });
}

/** What the shape stage reads. */
export interface ShapeInput {
  readonly registry: Registry;
  readonly rules: readonly NormalizedRule[];
  readonly action: ActionEntry;
  readonly principal: Principal;
  readonly scope: Scope;
  readonly environment: RowEnvironment;
  /** Finds the entity rows of an output; default: read from the registry on every call (the invoker memoises it). */
  readonly outputOf?: (action: ActionEntry) => EntityOutput | undefined;
  /** The handler's output, after the output translation. */
  readonly output: unknown;
  /** Called in production with each row the stage dropped (section 8.4). */
  readonly onDropped: (dropped: DroppedRow) => void;
}

/**
 * `shape` (section 9.2): which rows and fields leave the invoker. Every entity row of the output
 * (`rowOf`, `pageOf`) is checked against the caller's read plan and masked by its fields; a row
 * outside the plan fails the invocation in development and tests and is dropped and reported in
 * production, a page becoming shorter and a lone row `not_found`. A custom output holds no entity
 * row and is validated against its schema in development only.
 */
export async function shape(input: ShapeInput): Promise<unknown> {
  const { action, output } = input;
  const found = (input.outputOf ?? ((one) => entityOutputOf(input.registry, one)))(action);
  if (found === undefined) {
    if (input.environment === 'development') await checkOutput(action, output);
    return output;
  }
  if (found.form === 'row') {
    const [row] = await shapeRows(input, found.entity, [output]);
    if (row === undefined) throw errors.not_found(`"${action.ref}" found nothing you may see.`);
    return row;
  }
  if (!isRow(output) || !Array.isArray(output.items)) {
    throw new KeelwerkError({
      kind: 'internal',
      code: 'core.internal',
      message: `The page output of "${action.ref}" has no items.`,
    });
  }
  return { ...output, items: await shapeRows(input, found.entity, output.items) };
}
