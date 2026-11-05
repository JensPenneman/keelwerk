import { defineCommand } from '@keelwerk/core';
import { authBase } from '../../base.ts';
import { session } from '../../entities/session.ts';

/** Revokes one session; a session already revoked stays as it is. */
export const revoke = defineCommand(authBase, session, {
  execution: 'sync',
  decide: (_input, current, ctx) =>
    current.revokedAt === undefined
      ? [ctx.write.auth.session.update(current, { revokedAt: ctx.clock.now() })]
      : [],
});
