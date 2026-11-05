import { defineReaction, within } from '@keelwerk/core';
import { authBase } from '../../../base.ts';
import { tooManyRecords } from '../../../errors/too-many-records.ts';
import { whenAccounts } from '../condition.ts';

const pageSize = 100;

/** When a profile's e-mail address changes, the login identifier of its password credentials follows (5.4). */
export const syncIdentifier = defineReaction(within(authBase, whenAccounts), {
  on: 'accounts.profile.changed',
  timing: 'inline',
  *react(event, ctx) {
    const rows = yield* ctx.load.auth.credential.many({
      where: { profileId: event.state.id, kind: 'password', revokedAt: { isNull: true } },
      limit: pageSize,
    });
    if (rows.length >= pageSize) throw tooManyRecords();
    return rows
      .filter((row) => row.identifier !== event.state.email)
      .map((row) => ctx.write.auth.credential.update(row, { identifier: event.state.email }));
  },
});
