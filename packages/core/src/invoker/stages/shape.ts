import type { AuthorizedAction } from '../../authorization/authorized-action.ts';
import { checkRowInPlan } from '../../authorization/check-row-in-plan.ts';
import { createRowMatcher } from '../../authorization/create-row-matcher.ts';
import type { DroppedRow } from '../../authorization/dropped-row.ts';
import { isFieldRevealed } from '../../authorization/is-field-revealed.ts';
import type { NormalizedRule } from '../../authorization/normalized-rule.ts';
import type { Plan } from '../../authorization/plan.ts';
import type { RelationAnswerer } from '../../authorization/relation-answerer.ts';
import type { RowEnvironment } from '../../authorization/row-environment.ts';
import type { RowMatcher } from '../../authorization/row-matcher.ts';
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

/**
 * The action a row leaves the invoker under (section 8.4): a query of the entity itself is planned
 * as invoked, every other row (another entity's, or any a command returns) as the entity's
 * generated `get` for a `rowOf` output and `query` for a `pageOf` one, so a command's own rules
 * never grant or hide a read.
 */
function plannedAs(
  entry: EntityEntry,
  invoked: ActionEntry,
  form: EntityOutput['form'],
): AuthorizedAction {
  if (invoked.entity === entry.ref && invoked.kind === 'query') return invoked;
  const name = form === 'row' ? 'get' : 'query';
  return {
    ref: `${entry.ref}.${name}`,
    module: entry.module,
    entity: entry.ref,
    name,
    kind: 'query',
    generated: name,
    instance: false,
    auth: 'policy',
    scope: entry.descriptor.tenancy === 'backend' ? 'backend' : 'tenant',
  };
}

/** Without an answerer a relation quantifier cannot be answered after the unit closed: it fails closed. */
const noRelations: RelationAnswerer = (entity, node) =>
  Promise.reject(
    refuseRequest(
      `the ${node.op} on "${node.relation}" of ${entity}`,
      'the shape stage has no way to answer relation quantifiers here',
    ),
  );

/** Whether the plan selects the row, without reporting it. */
function inPlan(plan: Plan, matches: RowMatcher, row: StorageRow): boolean {
  return plan.kind === 'always' || (plan.kind === 'conditional' && matches(plan.where, row));
}

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

/**
 * The rows of an output that stay, masked. A command that succeeded never fails on its output
 * (S-106): a row outside the caller's read plan is left out here and the caller decides what
 * stands in its place. Any other action fails on such a row in development and tests and drops it
 * in production.
 */
async function shapeRows(
  input: ShapeInput,
  entry: EntityEntry,
  form: EntityOutput['form'],
  rows: readonly unknown[],
): Promise<ShapedRows> {
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
    action: plannedAs(entry, input.action, form),
    context: principalContextOf(input.registry, input.principal, input.scope),
  });
  const answerer = input.relations ?? noRelations;
  const matches = await createRowMatcher([view.plan.where], list, {
    entity: entry.ref,
    answerer,
  });
  const lenient = input.action.kind === 'command';
  const kept = list.filter((row) =>
    lenient
      ? inPlan(view.plan, matches, row)
      : checkRowInPlan({
          plan: view.plan,
          row,
          environment: input.environment,
          matches,
          onDropped: input.onDropped,
        }),
  );
  const masked = await view.mask(kept, answerer);
  const shaped = new Map<StorageRow, StorageRow>();
  kept.forEach((row, index) => {
    shaped.set(row, mergeMasked(row, masked[index] ?? row));
  });
  return { plan: view.plan, rows: list, shaped: list.map((row) => shaped.get(row)) };
}

/** The rows of an output after the read plan: the plan, the rows as returned and what became of each. */
interface ShapedRows {
  readonly plan: Plan;
  readonly rows: readonly StorageRow[];
  readonly shaped: readonly (StorageRow | undefined)[];
}

/**
 * One cursor of a page (section 14.3.5), or null. A cursor names its sort fields and carries
 * their values with the id of its edge row, so it is kept only when that row left the invoker and
 * none of its sort fields is one the caller's read plan hides: a field outside the read mask
 * cannot be a sort key. Development and tests fail on such a sort, production strips the cursor.
 */
function shapeCursor(input: ShapeInput, page: ShapedRows, cursor: unknown): unknown {
  if (typeof cursor !== 'string') return cursor;
  let parts: unknown;
  try {
    parts = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(parts) || parts.length !== 4) return null;
  const [names, , id] = parts as unknown[];
  if (!Array.isArray(names) || !names.every((name) => typeof name === 'string')) return null;
  const index = page.rows.findIndex((row) => row.id === id);
  if (index < 0 || page.shaped[index] === undefined) return null;
  const hidden = names.filter(
    (name: string) => page.plan.maskable.includes(name) && !isFieldRevealed(page.plan, name),
  );
  if (hidden.length === 0) return cursor;
  if (input.environment === 'production') return null;
  throw new KeelwerkError({
    kind: 'internal',
    code: 'core.internal',
    message: `The page of "${input.action.ref}" is sorted by ${hidden.map((name) => `"${name}"`).join(', ')}, which the read plan hides from this caller; its cursors would carry the value.`,
  });
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
  /** The reference a replayed entity command kept: it stands in for a row the caller may not read, or that is gone. */
  readonly replayRef?: { readonly entity: string; readonly id: string; readonly version: number };
  /** Answers the relation quantifiers of the plan; default: they fail closed. */
  readonly relations?: RelationAnswerer;
  /** Called in production with each row the stage dropped (section 8.4). */
  readonly onDropped: (dropped: DroppedRow) => void;
}

/**
 * `shape` (section 9.2): which rows and fields leave the invoker. Every entity row of the output
 * (`rowOf`, `pageOf`) is checked against the caller's read plan and masked by its fields; a row
 * outside the plan fails the invocation in development and tests and is dropped and reported in
 * production, a page becoming shorter and a lone row `not_found`. What a command returns never
 * fails it (S-106): a page drops the rows outside the plan and a lone row becomes the reference
 * `{ entity, id, version }`. A custom output holds no entity row and is validated against its
 * schema in development only.
 */
export async function shape(input: ShapeInput): Promise<unknown> {
  const { action, output } = input;
  const found = (input.outputOf ?? ((one) => entityOutputOf(input.registry, one)))(action);
  if (found === undefined) {
    if (input.environment === 'development') await checkOutput(action, output);
    return output;
  }
  if (found.form === 'row') {
    if (input.replayRef !== undefined && output === input.replayRef) return input.replayRef;
    const [row] = (await shapeRows(input, found.entity, 'row', [output])).shaped;
    if (row !== undefined) return row;
    if (action.kind !== 'command') {
      throw errors.not_found(`"${action.ref}" found nothing you may see.`);
    }
    // The command succeeded on a row its caller may not read (S-106): the receipt's reference stands in.
    if (input.replayRef !== undefined) return input.replayRef;
    const { id, version } = output as StorageRow;
    return { entity: found.entity.ref, id, version };
  }
  if (!isRow(output) || !Array.isArray(output.items)) {
    throw new KeelwerkError({
      kind: 'internal',
      code: 'core.internal',
      message: `The page output of "${action.ref}" has no items.`,
    });
  }
  const page = await shapeRows(input, found.entity, 'page', output.items);
  const items = page.shaped.filter((row) => row !== undefined);
  if (!isRow(output.pageInfo)) return { ...output, items };
  const pageInfo = { ...output.pageInfo };
  for (const name of ['startCursor', 'endCursor']) {
    if (name in pageInfo) pageInfo[name] = shapeCursor(input, page, pageInfo[name]);
  }
  return { ...output, items, pageInfo };
}
