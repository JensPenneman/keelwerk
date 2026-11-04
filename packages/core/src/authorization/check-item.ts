import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { RuleMatch } from '../errors/rule-match.ts';
import type { ChangeImages } from './change-images.ts';
import { forbiddenChanges } from './forbidden-changes.ts';
import type { ItemImages } from './item-images.ts';
import type { ItemVerdict } from './item-verdict.ts';
import { plainRowMatcher } from './plain-row-matcher.ts';
import type { Plan } from './plan.ts';
import type { PlanClause } from './plan-clause.ts';

const allowMatch = (clause: PlanClause): RuleMatch => ({ id: clause.rule, effect: 'allow' });
const denyMatch = (clause: PlanClause): RuleMatch => ({ id: clause.rule, effect: 'deny' });

function missing(plan: Plan, image: string): KeelwerkError {
  return new KeelwerkError({
    kind: 'internal',
    code: 'core.internal',
    message: `The ${plan.operation} check of "${plan.action}" needs the ${image}-image.`,
  });
}

function finish(
  plan: Plan,
  images: ItemImages,
  held: readonly PlanClause[],
  change: ChangeImages | undefined,
): ItemVerdict {
  const forbidden =
    images.changed === undefined || change === undefined
      ? []
      : forbiddenChanges(plan, held, change, images.changed);
  return {
    allowed: forbidden.length === 0 || images.mode === 'strip',
    rules: held.map(allowMatch),
    reason: undefined,
    forbiddenFields: forbidden,
  };
}

/**
 * The item check of section 8.4 against the decision algebra of section 8.2.
 *
 * - `read`: the row (`pre`, else `post`) is selected by some allow and no deny.
 * - `create`: the new row (`post`) matches some allow's `check ?? where` and no deny's.
 * - transitions: the target (`pre`) is selected (some allow's `where`, no deny without `check`),
 *   and the post-image passes (an allow that selected the target has no `check` or its `check`
 *   matches, and no deny with a `check` has its `where` match the pre-image and its `check` the
 *   post-image). With only the pre-image the selection is tested. The pre-image is required: only
 *   it says which allows selected the target, and an allow that did not select it lends no `check`.
 *
 * A write that changes fields no selecting allow lists is refused (`mode: 'strict'`) or reported
 * in `forbiddenFields` to be dropped (`mode: 'strip'`).
 */
export function checkItem(plan: Plan, images: ItemImages): ItemVerdict {
  const preMatch = images.matchers?.pre ?? plainRowMatcher();
  const postMatch = images.matchers?.post ?? plainRowMatcher();
  const fail = (rules: readonly RuleMatch[], reason?: string): ItemVerdict => ({
    allowed: false,
    rules,
    reason,
    forbiddenFields: [],
  });
  const wouldAllow = plan.allows.map(allowMatch);

  if (plan.operation === 'read') {
    const row = images.pre ?? images.post;
    if (row === undefined) throw missing(plan, 'pre');
    const deny = plan.denies.find((clause) => preMatch(clause.where, row));
    if (deny !== undefined) return fail([denyMatch(deny)], deny.reason);
    const held = plan.allows.filter((clause) => preMatch(clause.where, row));
    return held.length === 0
      ? fail(wouldAllow)
      : { allowed: true, rules: held.map(allowMatch), reason: undefined, forbiddenFields: [] };
  }

  if (plan.operation === 'create') {
    const row = images.post;
    if (row === undefined) throw missing(plan, 'post');
    const deny = plan.denies.find((clause) => postMatch(clause.where, row));
    if (deny !== undefined) return fail([denyMatch(deny)], deny.reason);
    const held = plan.allows.filter((clause) => postMatch(clause.where, row));
    if (held.length === 0) return fail(wouldAllow);
    return finish(plan, images, held, { preMatches: preMatch, post: row, postMatches: postMatch });
  }

  const { pre, post } = images;
  if (pre === undefined) throw missing(plan, 'pre');
  const denial = plan.denies.find((clause) => clause.check === null && preMatch(clause.where, pre));
  if (denial !== undefined) return fail([denyMatch(denial)], denial.reason);
  const selecting = plan.allows.filter((clause) => preMatch(clause.where, pre));
  if (selecting.length === 0) return fail(wouldAllow);
  if (post === undefined) {
    return {
      allowed: true,
      rules: selecting.map(allowMatch),
      reason: undefined,
      forbiddenFields: [],
    };
  }
  for (const deny of plan.denies) {
    if (deny.check === null) continue;
    if (preMatch(deny.where, pre) && postMatch(deny.check, post)) {
      return fail([denyMatch(deny)], deny.reason);
    }
  }
  const passing = selecting.filter(
    (clause) => clause.check === null || postMatch(clause.check, post),
  );
  if (passing.length === 0) return fail(selecting.map(allowMatch));
  return finish(plan, images, passing, { pre, preMatches: preMatch, post, postMatches: postMatch });
}
