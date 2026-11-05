import { checkItem } from '../authorization/check-item.ts';
import { compilePlan } from '../authorization/compile-plan.ts';
import { createRowMatcher } from '../authorization/create-row-matcher.ts';
import { forbiddenError } from '../authorization/forbidden-error.ts';
import { itemAction } from '../authorization/item-action.ts';
import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import { principalContextOf } from '../interpreter/principal-context-of.ts';
import type { Principal } from '../principals/principal.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { encodeEventValue } from './encode-event-value.ts';
import type { WrittenRow } from './written-row.ts';

/** The operation a row of a batch `set` was written by: its last event names it. */
function operationOfWritten(item: WrittenRow): 'create' | 'update' | 'archive' | 'restore' {
  if (item.created) return 'create';
  const last = item.events.at(-1)?.name;
  return last === 'archived' ? 'archive' : last === 'restored' ? 'restore' : 'update';
}

function changedFields(
  names: readonly string[],
  before: StorageRow,
  after: StorageRow,
): readonly string[] {
  return names.filter(
    (name) =>
      JSON.stringify(encodeEventValue(before[name]) ?? null) !==
      JSON.stringify(encodeEventValue(after[name]) ?? null),
  );
}

/** What the item check of a command's writes runs with. */
export interface CheckWrittenItemsInput {
  readonly unit: Unit;
  readonly registry: Registry;
  readonly rules: readonly NormalizedRule[];
  readonly action: ActionEntry;
  readonly principal: Principal;
  readonly scope: Scope;
  readonly written: readonly WrittenRow[];
}

/**
 * The item check of section 8.4 on the post-images of the command's own entity: a created row
 * against the `create` rules, a changed row against the `transition` rules with its pre-image,
 * changed fields included. It runs after the state is written, so a rule over a relation sees the
 * new rows, and a refusal (`forbidden`) fails the unit and rolls the writes back. Commands that
 * are not mounted on an entity have no row conditions to check; rows of other entities were
 * written under the module's own authority.
 */
export async function checkWrittenItems(input: CheckWrittenItemsInput): Promise<void> {
  const { action } = input;
  const ref = action.entity;
  if (ref === undefined) return;
  const own = input.written.filter((item) => item.entry.ref === ref);
  if (own.length === 0) return;
  const entry = own[0]?.entry;
  if (entry === undefined) return;
  const context = principalContextOf(input.registry, input.principal, input.scope);
  const planOf = (item: WrittenRow) =>
    compilePlan({
      rules: input.rules,
      action: action.generated === 'set' ? itemAction(action, operationOfWritten(item)) : action,
      entity: entry.descriptor,
      context,
    });
  const names = Object.keys(entry.descriptor.fields);
  for (const item of own) {
    const plan = planOf(item);
    if (item.created !== (plan.operation === 'create')) continue;
    const clauses = [...plan.allows, ...plan.denies, ...plan.fieldDenies];
    const conditions = clauses.flatMap((clause) =>
      clause.check === null ? [clause.where] : [clause.where, clause.check],
    );
    const rows = item.loaded === undefined ? [item.row] : [item.loaded, item.row];
    const matcher = await createRowMatcher(conditions, rows, {
      entity: entry.ref,
      answerer: async (related, node, ids) => {
        const target = input.registry.entities.get(related);
        return target === undefined
          ? new Set<string>()
          : input.unit.rows.matching(target.descriptor, ids, node);
      },
    });
    const verdict = checkItem(plan, {
      ...(item.loaded === undefined ? {} : { pre: item.loaded }),
      post: item.row,
      matchers: { pre: matcher, post: matcher },
      ...(item.loaded === undefined
        ? {}
        : { changed: changedFields(names, item.loaded, item.row) }),
    });
    if (!verdict.allowed) {
      throw forbiddenError({
        rules: verdict.rules,
        reason: verdict.reason,
        action: action.ref,
      });
    }
  }
}
