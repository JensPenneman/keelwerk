import { defineCommand, field, shape } from '@keelwerk/core';
import { authBase } from '../base.ts';

export const revokeSubject = defineCommand(authBase, {
  input: shape({ subject: field.subject(), reason: field.string() }),
  *decide(input, ctx) {
    const at = ctx.clock.now();
    const credentials = yield* ctx.load.auth.credential.many({
      where: { subject: input.subject, revokedAt: { isNull: true } },
      limit: 1000,
    });
    return credentials.map((c) =>
      ctx.write.auth.credential.revoked(c, { at, reason: input.reason }),
    );
  },
});
