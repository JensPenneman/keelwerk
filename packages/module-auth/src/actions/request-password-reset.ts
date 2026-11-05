import { defineCommand, field, shape } from '@keelwerk/core';
import { authBase } from '../base.ts';
import { readyResetToken } from '../lib/ready-reset-token.ts';
import { resetTokenFor } from '../lib/reset-token-for.ts';

/**
 * Issues a one-time reset token and hands it to the delivery fillers (S-43). The answer is the
 * same whether or not the identifier exists, and never carries the token.
 */
const requestPasswordResetDef = defineCommand(authBase, {
  input: shape({ identifier: field.string({ format: 'email' }) }),
  output: shape({ accepted: field.boolean() }),
  auth: { public: true },
  execution: 'sync',
  *decide(input, ctx) {
    // The id and the secret are drawn whether or not the identifier exists. The insert that follows
    // for a known identifier still takes longer than the empty answer; closing that difference
    // waits for M2's keyed job, which stores the token off the request path.
    const ready = yield* readyResetToken(ctx);
    const found = yield* ctx.load.auth.credential.one({
      where: { identifier: input.identifier, kind: 'password', revokedAt: { isNull: true } },
    });
    if (found === undefined) return { events: [], result: { accepted: true } };
    const issued = resetTokenFor(ctx, ready, found);
    const effects = [];
    for (const delivery of ctx.extensions.resetDelivery) {
      effects.push(
        ...(yield* delivery.deliver({
          identifier: input.identifier,
          token: issued.token,
          expiresAt: issued.expiresAt,
        })),
      );
    }
    return { events: [issued.draft], effects, result: { accepted: true } };
  },
});

type RequestPasswordResetPart = typeof requestPasswordResetDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface RequestPasswordReset extends RequestPasswordResetPart {}
export const requestPasswordReset: RequestPasswordReset = requestPasswordResetDef;
