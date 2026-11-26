import { defineCommand, field, setTimer, shape } from '@keelwerk/core';
import { authBase } from '../base.ts';
import { revokeSessions } from './revoke-sessions.ts';

const pageSize = 1000;

/**
 * Revokes every credential of a subject and sets the keyed timer that revokes their sessions page
 * by page (`revokeSessions`); internal and asynchronous: auth's reaction to a deactivation enqueues
 * it under `auth.system` (17.2.3), so the deactivating unit writes no credential and a login or a
 * change of password cannot make it repeat. The credentials are read a page at a time by id until a
 * short page. The person is refused from the deactivation's commit all the same, by the enricher of
 * accounts, and the open streams of their sessions end there.
 */
const revokeSubjectDef = defineCommand(authBase, {
  input: shape({ subject: field.subject(), reason: field.string() }),
  internal: true,
  execution: 'async',
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
