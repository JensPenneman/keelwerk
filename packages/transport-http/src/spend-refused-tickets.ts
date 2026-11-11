import type { Carrier } from '@keelwerk/core';
import { fillCarrier } from './fill-carrier.ts';
import type { SocketFacts } from './socket-facts.ts';
import { ticketPattern } from './ticket-pattern.ts';

/**
 * A well-formed ticket on any request but the one that carries it (`carriesTicket`), whatever its
 * path and method, is spent at once, so a ticket that reached a log or a proxy through a wrong
 * request is dead by the time anyone reads it: a request under `/_keelwerk/` is refused as before, a
 * request on a mounted path goes on as if the member were not a ticket, and the same ticket then
 * fails on the right endpoint. A value of another form costs no lookup, and only the first
 * well-formed value of a request is looked at and spent: the others are ignored, so a request costs
 * one lookup however many values it carries. The
 * ticket is redeemed like a presented one (`open` is the host's own opening of a session): the
 * kernel spends it and then refuses it with core.ticket_invalid, so no session opens and the
 * rejection is ignored. The ticket's binding to a subscription is not checked (`spendOnly`), so a
 * bound ticket is spent too.
 */
export async function spendRefusedTickets(
  request: Request,
  url: URL,
  facts: SocketFacts,
  open: (carrier: Carrier) => Promise<unknown>,
): Promise<void> {
  const value = url.searchParams.getAll('ticket').find((member) => ticketPattern.test(member));
  if (value === undefined) return;
  const base = fillCarrier(request, facts);
  // The bearer token fillCarrier took from `Authorization` goes too: a ticket request carries no other credential.
  const { token: _token, ...rest } = base;
  const { cookie: _cookie, authorization: _authorization, ...headers } = rest.headers ?? {};
  const ticket = {
    value,
    endpoint: 'subscribe',
    action: url.searchParams.get('action'),
    spendOnly: true,
  } as const;
  await open({ ...rest, headers, ticket }).catch(() => undefined);
}
