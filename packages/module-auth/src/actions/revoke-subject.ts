import { defineCommand, errors, field, shape } from '@keelwerk/core';
import { authBase } from '../base.ts';

const pageSize = 1000;

/** Revokes every credential and session of a subject; invoked by auth's own reactions under `auth.system` (17.2.3). */
const revokeSubjectDef = defineCommand(authBase, {
  input: shape({ subject: field.subject(), reason: field.string() }),
  execution: 'sync',
  *decide(input, ctx) {
    const at = ctx.clock.now();
    const [credentials, sessions] = yield* ctx.all([
      ctx.load.auth.credential.many({
        where: { subject: input.subject, revokedAt: { isNull: true } },
        limit: pageSize,
      }),
      ctx.load.auth.session.many({
        where: {
          subject: input.subject,
          revokedAt: { isNull: true },
          absoluteExpiresAt: { gt: at },
        },
        limit: pageSize,
      }),
    ]);
    // A full page may hide more rows; revoking part of a subject's sessions would leave live ones behind.
    if (credentials.length >= pageSize || sessions.length >= pageSize) {
      throw errors.internal('Too many live credentials or sessions to revoke in one command.');
    }
    return [
      ...credentials.map((row) =>
        ctx.write.auth.credential.revoked(row, { at, reason: input.reason }),
      ),
      ...sessions.map((row) => ctx.write.auth.session.update(row, { revokedAt: at })),
    ];
  },
});

type RevokeSubjectPart = typeof revokeSubjectDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface RevokeSubject extends RevokeSubjectPart {}
export const revokeSubject: RevokeSubject = revokeSubjectDef;
