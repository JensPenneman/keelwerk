import type { CreateDraft, Id, SubjectId } from '@keelwerk/core';
import type { ReadyResetToken } from './ready-reset-token.ts';
import type { ResetTokenContext } from './reset-token-context.ts';
import { resetTokenMinutes } from './reset-token-minutes.ts';

/** A reset token as issued: the row to store, and the plaintext that goes to its holder once. */
export interface IssuedResetToken {
  readonly draft: CreateDraft;
  readonly token: string;
  readonly expiresAt: Temporal.Instant;
}

/** The reset token to store for a password credential, from what `readyResetToken` drew (17.2.5, S-43). */
export function resetTokenFor(
  ctx: ResetTokenContext,
  ready: ReadyResetToken,
  credential: { readonly id: Id<'auth.credential'>; readonly subject: SubjectId },
): IssuedResetToken {
  const expiresAt = ctx.clock.now().add({ minutes: resetTokenMinutes });
  return {
    draft: ctx.write.auth.resetToken.create({
      id: ready.id,
      subject: credential.subject,
      credentialId: credential.id,
      publicId: ready.issued.publicId,
      tokenVerifier: ready.issued.verifier,
      expiresAt,
    }),
    token: ready.issued.plain,
    expiresAt,
  };
}
