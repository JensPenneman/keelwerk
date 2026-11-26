import { defineCommand, field, setTimer, shape } from '@keelwerk/core';
import { authBase } from '../base.ts';
import { revokeSessions } from './revoke-sessions.ts';

const pageSize = 1000;

/**
 * Revokes every credential of a subject in the deactivating unit and sets the keyed timer that
 * revokes their sessions page by page (`revokeSessions`); internal, invoked by auth's own reactions
 * under `auth.system` (17.2.3). The credentials are read a page at a time by id until a short page. The
 * unit can be raced: every login and every password change appends to the credential's stream, and
 * a step that commits between this unit's read and its commit makes the unit repeat on a version
 * conflict (the kernel repeats it three times). What bounds the race is the cap of
 * `successfulLoginsPerMinute` sessions per credential per minute, which login and change of password
 * check before they write: a principal who holds the password can make the unit repeat only that
 * often, and once the cap is used up nothing more commits, so a repeat of the deactivation succeeds.
 * A form that cannot be raced at all needs a record of its own that the deactivation writes and
 * every check reads. The sessions are not touched here: a person who holds thousands of them and
 * uses them all the time changes the rows under a unit that rewrites them, and the unit fails on a
 * version check, so they would veto their own deactivation. Their sessions are dead at once all the
 * same, since `resolve` and `fromRef` judge a session by its credential, and the open streams of the
 * session end with it (`dependsOn`).
 */
const revokeSubjectDef = defineCommand(authBase, {
  input: shape({ subject: field.subject(), reason: field.string() }),
  internal: true,
  execution: 'sync',
  *decide(input, ctx) {
    const at = ctx.clock.now();
    const writes = [];
    let after: string | undefined;
    for (;;) {
      const rows = yield* ctx.load.auth.credential.many({
        where: {
          subject: input.subject,
          revokedAt: { isNull: true },
          ...(after === undefined ? {} : { id: { gt: after as never } }),
        },
        sort: [{ field: 'id', direction: 'asc' }],
        limit: pageSize,
      });
      writes.push(
        ...rows.map((row) => ctx.write.auth.credential.revoked(row, { at, reason: input.reason })),
      );
      const last = rows.at(-1);
      if (last === undefined || rows.length < pageSize) break;
      after = last.id;
    }
    return {
      events: writes,
      effects: [
        setTimer({
          key: `revokeSessions:${input.subject}`,
          invoke: revokeSessions,
          input: { subject: input.subject },
          at,
        }),
      ],
    };
  },
});

type RevokeSubjectPart = typeof revokeSubjectDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface RevokeSubject extends RevokeSubjectPart {}
export const revokeSubject: RevokeSubject = revokeSubjectDef;
