import { allOf } from '../authorization/all-of.ts';
import type { AuthorizedAction } from '../authorization/authorized-action.ts';
import { checkFilterFields } from '../authorization/check-filter-fields.ts';
import { compilePlan } from '../authorization/compile-plan.ts';
import { createRowMatcher } from '../authorization/create-row-matcher.ts';
import { maskRow } from '../authorization/mask-row.ts';
import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import type { Plan } from '../authorization/plan.ts';
import type { RelationAnswerer } from '../authorization/relation-answerer.ts';
import type { Condition } from '../conditions/condition.ts';
import { conditionFields } from '../conditions/condition-fields.ts';
import type { PrincipalContext } from '../contexts/principal-context.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { StorageRow } from '../storage/storage-row.ts';

/** What the caller's read plan does to one entity's reads: it narrows the selection and masks the rows. */
export interface CallerView {
  readonly plan: Plan;
  /**
   * The selection a caller's read may use: `where` conjoined with the plan's. A filter or sort on
   * a field the caller cannot see is `forbidden`.
   */
  select(where: Condition | undefined, sortFields: readonly string[]): Condition;
  /** Masks the rows by the plan's fields; the names left out come back as `$masked`. */
  mask(rows: readonly StorageRow[], answerer: RelationAnswerer): Promise<readonly StorageRow[]>;
}

/** What the view is built from. */
export interface CallerViewInput {
  readonly entry: EntityEntry;
  readonly rules: readonly NormalizedRule[];
  /** The action whose plan applies: the invoked action for `ctx.target`, else the entity's generated `query`. */
  readonly action: AuthorizedAction;
  readonly context: PrincipalContext;
}

/** The caller's view of an entity (section 8.4): its read plan, compiled once, and the mask. */
export function callerView(input: CallerViewInput): CallerView {
  const { entry, rules, action, context } = input;
  const plan = compilePlan({ rules, action, entity: entry.descriptor, context });
  return {
    plan,
    select(where, sortFields) {
      const fields = where === undefined ? [] : conditionFields(where).fields;
      checkFilterFields(plan, [...fields, ...sortFields]);
      return allOf(where === undefined ? [plan.where] : [where, plan.where]);
    },
    async mask(rows, answerer) {
      if (plan.maskable.length === 0 || rows.length === 0) return rows;
      const conditions = [...plan.allows, ...plan.fieldDenies].map((clause) => clause.where);
      const matches = await createRowMatcher(conditions, rows, {
        entity: entry.ref,
        answerer,
      });
      return rows.map((row) => maskRow(plan, row, matches));
    },
  };
}
