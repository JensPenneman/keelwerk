import {
  defineFill,
  type Principal,
  type PrincipalResolution,
  parseToken,
  within,
} from '@keelwerk/core';
import { liveBase } from '../live-base.ts';
import { liveToCore } from '../live-to-core.ts';
import { ticketInvalid } from './ticket-invalid.ts';
import { ticketPrefix } from './ticket-prefix.ts';

const resolverId = 'live.ticket';
const ticketScheme = { scheme: 'apiKey', name: 'ticket' } as const;

/**
 * The resolver of a stream ticket (15.4.6, S-161): a carrier that holds a ticket (the host fills it on
 * `GET /_keelwerk/v1/subscribe` only) is accepted when the secret verifies against the stored keyed
 * verifier, the ticket is unspent, younger than its expiry, bound to this endpoint and, when it names
 * one, to this subscription. It does not name a principal: it hands the kernel the redemption, which
 * spends the ticket and resolves the stored principal reference. Everything else is the one
 * `core.ticket_invalid`, so a caller learns nothing of why.
 */
const ticketResolver = defineFill(within(liveBase, liveToCore), 'principalResolvers', (own) => [
  {
    id: resolverId,
    describe: () => ticketScheme,
    *resolve(carrier, { scope, clock }) {
      const { ticket } = carrier;
      if (ticket === undefined) return null;
      // No subscription opens at the deployment level yet; a ticket there is refused before any load.
      if (scope.level === 'deployment') throw ticketInvalid();
      const parsed = parseToken(ticket.value);
      if (parsed === undefined || parsed.prefix !== ticketPrefix) throw ticketInvalid();
      const row = yield* own.load.live.streamTicket.one({ where: { publicId: parsed.publicId } });
      if (row === undefined) throw ticketInvalid();
      const verified = yield* own.secrets.verify(ticket.value, row.verifier);
      if (
        !verified ||
        row.usedAt !== undefined ||
        Temporal.Instant.compare(row.expiresAt, clock.now()) <= 0 ||
        (ticket.spendOnly !== true &&
          (row.endpoint !== ticket.endpoint ||
            (row.action !== undefined && row.action !== ticket.action)))
      ) {
        throw ticketInvalid();
      }
      const anonymous: Principal = {
        kind: 'anonymous',
        scope: {
          backend: scope.backendId,
          tenant: scope.level === 'tenant' ? scope.tenantId : null,
        },
        claims: {},
        roles: [],
        memberships: [],
        via: resolverId,
        ref: null,
      };
      const resolution: PrincipalResolution = {
        principal: anonymous,
        redeem: {
          entity: 'live.streamTicket',
          id: row.id,
          version: Number(row.version),
          ref: row.principal,
        },
      };
      return resolution;
    },
  },
]);

/** The same fill with `describe` beside its factory: a surface derived without a runtime needs no bound context (16.2). */
export const ticketResolverFill: typeof ticketResolver = {
  ...ticketResolver,
  factory: Object.assign(ticketResolver.factory, {
    describe: () => [{ id: resolverId, ...ticketScheme }],
  }),
};
