import { defineCommand, errors, field, shape } from '@keelwerk/core';
import { liveBase } from '../live-base.ts';
import { streamTicket } from './stream-ticket.ts';
import { ticketLifetimeSeconds } from './ticket-lifetime-seconds.ts';
import { ticketPrefix } from './ticket-prefix.ts';

/**
 * Issues a stream ticket for the caller (15.4.6, S-161): a credential that fits in a URL, because an
 * `EventSource` cannot send headers. It holds the caller's principal reference, lives for a minute and
 * opens one stream; the receipt never keeps it. Only the keyed verifier is stored.
 */
const issueTicketDef = defineCommand(liveBase, {
  input: shape({ action: field.string({ maxLength: 200 }).optional() }),
  output: shape({ ticket: field.string(), expiresAt: field.instant() }),
  shownOnce: ['ticket'],
  principal: 'user',
  scope: 'invocation',
  execution: 'sync',
  *decide(input, ctx) {
    if (ctx.scope.level === 'deployment') {
      throw errors.unsupported(
        'A subscription at the deployment level is not available yet, so neither is its ticket.',
      );
    }
    const { ref } = ctx.principal;
    if (ref === null)
      throw errors.forbidden('Only a principal that can be resolved again may ask for a ticket.');
    const id = yield* ctx.newId(streamTicket);
    const issued = yield* ctx.secrets.issue({ prefix: ticketPrefix });
    const expiresAt = ctx.clock.now().add({ seconds: ticketLifetimeSeconds });
    return {
      events: [
        ctx.write.live.streamTicket.create({
          id,
          publicId: issued.publicId,
          verifier: issued.verifier,
          principal: ref,
          principalResolver: ref.resolver,
          principalId: ref.principalId,
          ...(input.action === undefined ? {} : { action: input.action }),
          endpoint: 'subscribe',
          expiresAt,
        }),
      ],
      result: { ticket: issued.plain, expiresAt },
    };
  },
});

type IssueTicketPart = typeof issueTicketDef;
/** The action's type, named once so the rule and the module do not repeat it. */
export interface IssueTicket extends IssueTicketPart {}
export const issueTicket: IssueTicket = issueTicketDef;
