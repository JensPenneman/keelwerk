import type { Gen, Id } from '@keelwerk/core';
import { resetToken } from '../entities/reset-token.ts';
import type { ResetTokenContext } from './reset-token-context.ts';
import { resetTokenPrefix } from './reset-token-prefix.ts';

/** A reset token's id and secret, drawn before it is known whether it will be stored. */
export interface ReadyResetToken {
  readonly id: Id<'auth.resetToken'>;
  readonly issued: { readonly publicId: string; readonly verifier: string; readonly plain: string };
}

/**
 * Draws the id and the secret of a reset token. A reset request draws both whether or not the
 * identifier exists, so the two answers cost the same.
 */
export function* readyResetToken(ctx: ResetTokenContext): Gen<ReadyResetToken> {
  const id = yield* ctx.newId(resetToken);
  const issued = yield* ctx.secrets.issue({ prefix: resetTokenPrefix });
  return { id, issued };
}
