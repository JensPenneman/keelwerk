import type { DecideContext, Gen, SubjectId, UpdateDraft } from '@keelwerk/core';
import type { AuthBase } from '../base.ts';
import { tooManyRecords } from '../errors/too-many-records.ts';

const pageSize = 1000;

type Own = DecideContext<AuthBase>;
type SessionsContext = Pick<Own, 'clock'> & {
  readonly load: { readonly auth: Own['load']['auth'] };
  readonly write: { readonly auth: Own['write']['auth'] };
};

/**
 * The drafts that revoke every live session of `subject` except `keep` (the caller's own, when
 * there is one). A full page may hide more rows, and leaving live sessions behind would defeat the
 * revocation, so a subject with that many sessions is refused with a declared error instead (17.2.3).
 */
export function* revokeOtherSessions(
  ctx: SessionsContext,
  subject: SubjectId,
  keep: string | undefined,
): Gen<readonly UpdateDraft[]> {
  const at = ctx.clock.now();
  const sessions = yield* ctx.load.auth.session.many({
    where: { subject, revokedAt: { isNull: true }, absoluteExpiresAt: { gt: at } },
    limit: pageSize,
  });
  if (sessions.length >= pageSize) {
    throw tooManyRecords();
  }
  return sessions
    .filter((row) => row.id !== keep)
    .map((row) => ctx.write.auth.session.update(row, { revokedAt: at }));
}
