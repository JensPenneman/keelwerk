import { defineCommand } from '../../../../../../define-command.ts';
import { field } from '../../../../../../field.ts';
import { shape } from '../../../../../../shape.ts';
import { within } from '../../../../../../within.ts';
import { authBase } from '../../../../base.ts';
import { toAccounts } from '../../contribution.ts';

export const resetPassword = defineCommand(within(authBase, toAccounts), 'profile', {
  input: shape({ newPassword: field.secret() }),
  principal: 'user',
  *decide(input, current, ctx) {
    const salt = yield* ctx.random(16);
    const verifier = yield* ctx.compute.argon2idHash(input.newPassword, salt);
    const cred = yield* ctx.load.auth.credential.one({
      where: { subject: ctx.principal.subject, kind: 'password' },
    });
    return [
      ...(cred ? [ctx.write.auth.credential.update(cred, { verifier })] : []),
      ctx.write.accounts.profile.update(current, { lastLoginAt: ctx.clock.now() }),
    ];
  },
});
