import { defineReaction, type SubjectId, within } from '@keelwerk/core';
import { authBase } from '../../../base.ts';
import { tooManyRecords } from '../../../errors/too-many-records.ts';
import { subjectOfProfile } from '../../../lib/subject-of-profile.ts';
import { whenAccounts } from '../condition.ts';

const pageSize = 1000;

/**
 * Links the credential whose sign-up caused a profile to that profile and makes the profile id its
 * subject (17.2.1, S-40). Personal values and live sessions follow the new subject.
 *
 * Only a profile that `registerProfile` created inside a sign-up is linked: that is the one
 * profile the kernel creates under the system principal, in the unit that created the credential.
 * The sign-up marks its credential `linkPending` and the marker is cleared here in the same unit, so
 * a system-invoked `accounts.register` from another module (a tenant hook, an import) never claims
 * an older unlinked credential of the same address. The profile must also have a cause among the
 * events (`causationId`), which a profile created by a command of its own has not. The cause alone
 * never decides: another module's inline invoke on the same `signedUp` event carries the same cause,
 * so the identifier and the marker stay the guard (open point 463 of the specification).
 */
export const linkProfile = defineReaction(within(authBase, whenAccounts), {
  on: 'accounts.profile.created',
  timing: 'inline',
  *react(event, ctx) {
    // A profile created by a command of a person or an operator has no cause among the events: it is never the one a sign-up made.
    if (event.causationId === null) return [];
    const found = yield* ctx.load.auth.credential.one({
      where: {
        identifier: event.state.email,
        kind: 'password',
        revokedAt: { isNull: true },
        profileId: { isNull: true },
        linkPending: true,
      },
    });
    if (found === undefined) return [];
    const subject: SubjectId = subjectOfProfile(event.state.id);
    const sessions = yield* ctx.load.auth.session.many({
      where: { subject: found.subject },
      limit: pageSize,
    });
    if (sessions.length >= pageSize) {
      throw tooManyRecords();
    }
    return [
      ctx.write.auth.credential.update(found, {
        profileId: event.state.id,
        linkPending: false,
        subject,
        ...(found.identifier === undefined ? {} : { identifier: found.identifier }),
      }),
      ...sessions.map((row) =>
        ctx.write.auth.session.update(row, {
          subject,
          ...(row.userAgent === undefined ? {} : { userAgent: row.userAgent }),
          ...(row.address === undefined ? {} : { address: row.address }),
        }),
      ),
    ];
  },
});
