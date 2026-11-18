import { defineCommand, field, shape } from '@keelwerk/core';
import { authBase } from '../base.ts';
import { readyResetToken } from '../lib/ready-reset-token.ts';
import { resetTokenFor } from '../lib/reset-token-for.ts';
import { resetTokenMinutes } from '../lib/reset-token-minutes.ts';
import { retireResetTokens } from '../lib/retire-reset-tokens.ts';

/**
 * Issues the one-time reset token of a credential and hands it to the delivery fillers (17.2.5,
 * S-43). `requestPasswordReset` sets it as a keyed timer, for the credential it found or for a
 * decoy id when the identifier is unknown, so the request stores and delivers nothing itself and
 * answers alike for every identifier. It runs as the module's own service principal, so no caller
 * reaches it from outside. A credential that is absent, revoked or not a password stores and
 * delivers nothing, and so does one that was already sent `resetRequestsPerHour` links in the last
 * hour: the request that led here answered as it always does. A token that is issued retires the
 * unused ones before it, so a newer link retires the older ones. Deliveries that run at the same
 * moment each read the same tokens before either commits: each leaves a live link, both for this
 * credential and both for its address, and the hourly cap is passed by the number of overlapping
 * deliveries (an attacker who asks again can replace the link of the person, and can pile up
 * links only as far as deliveries overlap).
 */
const deliverPasswordResetDef = defineCommand(authBase, {
  input: shape({ credentialId: field.ref.own('credential') }),
  principal: 'service',
  execution: 'sync',
  *decide(input, ctx) {
    const found = yield* ctx.load.auth.credential.byId(input.credentialId);
    if (
      found === undefined ||
      found.revokedAt !== undefined ||
      found.kind !== 'password' ||
      found.identifier === undefined
    ) {
      return [];
    }
    // A token expires `resetTokenMinutes` after it was issued, so the ones issued in the last hour are those that expire after this.
    const issuedSince = ctx.clock.now().subtract({ hours: 1 }).add({ minutes: resetTokenMinutes });
    const cap = ctx.config.resetRequestsPerHour;
    const recent = yield* ctx.load.auth.resetToken.many({
      where: { credentialId: found.id, expiresAt: { gt: issuedSince } },
      limit: cap,
    });
    if (recent.length >= cap) return [];
    const retired = yield* retireResetTokens(ctx, found.id, undefined);
    const ready = yield* readyResetToken(ctx);
    const issued = resetTokenFor(ctx, ready, found);
    const effects = [];
    for (const delivery of ctx.extensions.resetDelivery) {
      effects.push(
        ...(yield* delivery.deliver({
          identifier: found.identifier,
          token: issued.token,
          expiresAt: issued.expiresAt,
        })),
      );
    }
    return { events: [...retired, issued.draft], effects };
  },
});

type DeliverPasswordResetPart = typeof deliverPasswordResetDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface DeliverPasswordReset extends DeliverPasswordResetPart {}
export const deliverPasswordReset: DeliverPasswordReset = deliverPasswordResetDef;
