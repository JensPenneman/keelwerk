import { defineCommand, field, setTimer, shape } from '@keelwerk/core';
import { authBase } from '../base.ts';

/** The live sessions one unit revokes. */
const revokeSessionsPageSize = 200;

/**
 * Revokes the live sessions of a subject, one page per unit, and sets itself again until a short
 * page (17.2.3). `revokeSubject` revokes the credentials in the deactivating unit and sets this as
 * a keyed timer, because a person who holds thousands of sessions and uses them keeps changing the
 * rows the deactivating unit would have to rewrite, and each change makes that unit fail on a
 * version check: they must not be able to veto their own deactivation. The sessions of a revoked
 * credential are already dead (`isLiveSession`), so the pages only tidy the rows. It runs as the
 * module's own service principal, so no caller reaches it from outside.
 */
const revokeSessionsDef = defineCommand(authBase, {
  input: shape({ subject: field.subject() }),
  principal: 'service',
  execution: 'sync',
  *decide(input, ctx) {
    const at = ctx.clock.now();
    // The rows that were revoked leave the query, so every page starts from the beginning.
    const rows = yield* ctx.load.auth.session.many({
      where: {
        subject: input.subject,
        revokedAt: { isNull: true },
        absoluteExpiresAt: { gt: at },
      },
      sort: [{ field: 'id', direction: 'asc' }],
      limit: revokeSessionsPageSize,
    });
    return {
      events: rows.map((row) => ctx.write.auth.session.update(row, { revokedAt: at })),
      effects:
        rows.length < revokeSessionsPageSize
          ? []
          : [
              setTimer({
                key: `revokeSessions:${input.subject}`,
                // By reference: naming the command itself would make its type circular.
                invoke: 'auth.revokeSessions',
                input,
                at,
              }),
            ],
    };
  },
});

type RevokeSessionsPart = typeof revokeSessionsDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface RevokeSessions extends RevokeSessionsPart {}
export const revokeSessions: RevokeSessions = revokeSessionsDef;
