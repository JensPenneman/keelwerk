import type { Gen, Id, SubjectId } from '@keelwerk/core';
import { readyResetToken } from './ready-reset-token.ts';
import type { ResetTokenContext } from './reset-token-context.ts';
import { type IssuedResetToken, resetTokenFor } from './reset-token-for.ts';

/** Issues a one-time reset token for a password credential (17.2.5, S-43). */
export function* issueResetToken(
  ctx: ResetTokenContext,
  credential: { readonly id: Id<'auth.credential'>; readonly subject: SubjectId },
): Gen<IssuedResetToken> {
  return resetTokenFor(ctx, yield* readyResetToken(ctx), credential);
}
