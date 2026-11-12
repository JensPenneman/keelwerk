import type { Plan } from '../authorization/plan.ts';
import { sha256 } from '../crypto/sha256.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import { encodeEventValue } from '../write-path/encode-event-value.ts';

/**
 * The key of a plan group: subscribers whose plans have the same key share one present and one
 * disclosure pass. A kernel view (one with `members`) names them, so it never shares a group with
 * an app view; an app view keeps the key it always had.
 */
export function livePlanKeyOf(plan: Plan, members: readonly string[] | undefined): string {
  const clauses = (list: Plan['allows']) =>
    list.map((clause) => ({
      rule: clause.rule,
      where: clause.where,
      fields: clause.fields === null ? null : [...clause.fields].sort(),
    }));
  return sha256(
    canonicalizeJson(
      encodeEventValue({
        kind: plan.kind,
        where: plan.where,
        maskable: [...plan.maskable].sort(),
        ...(members === undefined ? {} : { members: [...members] }),
        allows: clauses(plan.allows),
        fieldDenies: clauses(plan.fieldDenies),
      }),
    ),
  );
}
