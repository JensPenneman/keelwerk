import { type DecideContext, errors, type Gen } from '@keelwerk/core';
import type { MembersBase } from '../base.ts';

/**
 * Refuses unless the caller holds an admin or owner membership right now. The membership is loaded,
 * not read from the session, so a session that outlives the caller's removal or demotion (a
 * long-lived connection is enriched once) cannot go on using the power the person no longer holds.
 * It guards against a stale session, not against a demotion that commits at the same instant.
 */
export function* requireLiveAdmin(
  ctx: Pick<DecideContext<MembersBase>, 'load' | 'principal'>,
  reason: string,
): Gen<void> {
  const { principal } = ctx;
  if (principal.kind !== 'user') throw errors.forbidden(reason);
  const live = yield* ctx.load.members.membership.one({
    where: { subject: principal.subject, role: { in: ['admin', 'owner'] } },
  });
  if (live === undefined) throw errors.forbidden(reason);
}
