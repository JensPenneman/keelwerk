import type { KeelwerkError } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';
import { carriesTicket } from './carries-ticket.ts';

const reserved = '/_keelwerk/';

/**
 * Where a `ticket` in the query is refused: anywhere under `/_keelwerk/` but the one request where
 * it is a credential (`carriesTicket`), with unauthenticated `core.ticket_invalid` before a session
 * opens, so no other endpoint ever sees it. Other paths: null, the request goes on as if the member
 * were not a ticket (a mounted API may use the name for its own purposes); the host spends a
 * well-formed value on every request but the one that carries it (`spendRefusedTickets`).
 */
export function ticketRefusal(request: Request, url: URL): KeelwerkError | null {
  if (!url.searchParams.has('ticket') || !url.pathname.startsWith(reserved)) return null;
  return carriesTicket(request, url) ? null : coreError('core.ticket_invalid');
}
