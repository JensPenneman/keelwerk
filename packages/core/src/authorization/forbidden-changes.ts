import type { ChangeImages } from './change-images.ts';
import type { Plan } from './plan.ts';
import type { PlanClause } from './plan-clause.ts';

function denyApplies(deny: PlanClause, images: ChangeImages): boolean {
  const { pre, preMatches, post, postMatches } = images;
  if (pre === undefined) return postMatches(deny.where, post);
  return preMatches(deny.where, pre) && (deny.check === null || postMatches(deny.check, post));
}

/**
 * The changed fields a write may not touch (section 8.1): those no allow rule that selected the
 * row lists (an allow without a field list covers every field), and those a deny rule that matches
 * the row lists. A deny applies to a transition when its `where` matches the pre-image (and its
 * `check`, if it has one, the post-image), so a write cannot step out of the deny's reach; to a
 * create when its condition matches the new row.
 */
export function forbiddenChanges(
  plan: Plan,
  selecting: readonly PlanClause[],
  images: ChangeImages,
  changed: readonly string[],
): readonly string[] {
  const denied = new Set<string>();
  for (const deny of plan.fieldDenies) {
    if (deny.fields !== null && denyApplies(deny, images)) {
      for (const field of deny.fields) denied.add(field);
    }
  }
  const everything = selecting.some((clause) => clause.fields === null);
  const listed = new Set<string>();
  for (const clause of selecting) for (const field of clause.fields ?? []) listed.add(field);
  return changed.filter((field) => denied.has(field) || (!everything && !listed.has(field)));
}
