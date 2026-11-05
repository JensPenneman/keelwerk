import type { DecideContext, Gen, Id, UpdateDraft } from '@keelwerk/core';
import type { AuthBase } from '../base.ts';
import { tooManyRecords } from '../errors/too-many-records.ts';

const pageSize = 1000;

type Own = DecideContext<AuthBase>;
type RetireContext = Pick<Own, 'clock'> & {
  readonly load: { readonly auth: Own['load']['auth'] };
  readonly write: { readonly auth: Own['write']['auth'] };
};

/**
 * The drafts that mark every unused, unexpired reset token of a credential as used, except `keep`
 * (the one being consumed, which the caller updates itself). A reset or a password change makes
 * the other links of that credential worthless (17.2.5), so none can set the password again.
 */
export function* retireResetTokens(
  ctx: RetireContext,
  credentialId: Id<'auth.credential'>,
  keep: string | undefined,
): Gen<readonly UpdateDraft[]> {
  const at = ctx.clock.now();
  const rows = yield* ctx.load.auth.resetToken.many({
    where: { credentialId, usedAt: { isNull: true }, expiresAt: { gt: at } },
    limit: pageSize,
  });
  if (rows.length >= pageSize) {
    throw tooManyRecords();
  }
  return rows
    .filter((row) => row.id !== keep)
    .map((row) => ctx.write.auth.resetToken.update(row, { usedAt: at }));
}
