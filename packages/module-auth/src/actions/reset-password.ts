import { defineCommand, field, parseToken, shape } from '@keelwerk/core';
import { authBase } from '../base.ts';
import { resetTokenInvalid } from '../errors/reset-token-invalid.ts';
import { tooManyRecords } from '../errors/too-many-records.ts';
import { resetTokenPrefix } from '../lib/reset-token-prefix.ts';
import { retireResetTokens } from '../lib/retire-reset-tokens.ts';
import { revokeOtherSessions } from '../lib/revoke-other-sessions.ts';

const saltBytes = 16;

/**
 * Consumes a reset token, sets the new password and revokes every session of the subject
 * and every other open reset link of the credential (17.2.5). An unknown, used, expired or forged token all answer `auth.reset_token_invalid`.
 */
const resetPasswordDef = defineCommand(authBase, {
  input: shape({ token: field.secret(), newPassword: field.secret() }),
  output: shape({ reset: field.boolean() }),
  errors: [resetTokenInvalid, tooManyRecords],
  auth: { public: true },
  execution: 'sync',
  *decide(input, ctx) {
    const parsed = parseToken(input.token);
    if (parsed === undefined || parsed.prefix !== resetTokenPrefix) throw resetTokenInvalid();
    const row = yield* ctx.load.auth.resetToken.one({ where: { publicId: parsed.publicId } });
    const verified =
      row === undefined ? false : yield* ctx.secrets.verify(input.token, row.tokenVerifier);
    const now = ctx.clock.now();
    if (
      row === undefined ||
      !verified ||
      row.usedAt !== undefined ||
      Temporal.Instant.compare(row.expiresAt, now) <= 0
    ) {
      throw resetTokenInvalid();
    }
    const found = yield* ctx.load.auth.credential.byId(row.credentialId);
    if (found === undefined || found.revokedAt !== undefined || found.kind !== 'password') {
      throw resetTokenInvalid();
    }
    const verifier = yield* ctx.compute.argon2idHash(
      input.newPassword,
      yield* ctx.random(saltBytes),
    );
    return {
      events: [
        ctx.write.auth.resetToken.update(row, { usedAt: now }),
        ctx.write.auth.credential.update(found, { verifier }),
        ...(yield* retireResetTokens(ctx, found.id, row.id)),
        ...(yield* revokeOtherSessions(ctx, found.subject, undefined)),
      ],
      result: { reset: true },
    };
  },
});

type ResetPasswordPart = typeof resetPasswordDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface ResetPassword extends ResetPasswordPart {}
export const resetPassword: ResetPassword = resetPasswordDef;
