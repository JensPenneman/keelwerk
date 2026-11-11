import { ticketPattern } from './ticket-pattern.ts';

const subscribePath = '/_keelwerk/v1/subscribe';

/** Whether the request is the one place a `ticket` is a credential: `GET /_keelwerk/v1/subscribe` with exactly one well-formed value. */
export function carriesTicket(request: Request, url: URL): boolean {
  const values = url.searchParams.getAll('ticket');
  const only = values[0];
  return (
    request.method === 'GET' &&
    url.pathname === subscribePath &&
    values.length === 1 &&
    only !== undefined &&
    ticketPattern.test(only)
  );
}
