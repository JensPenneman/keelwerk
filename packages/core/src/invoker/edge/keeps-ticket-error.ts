import { isKeelwerkError } from '../../errors/is-keelwerk-error.ts';

/**
 * Whether an error met while a ticket is redeemed stays what it is: only an internal or unavailable
 * error, or a failure that is no keelwerk error, does. Every other error (a rate limit and a missing
 * implementation included) is dropped, so a ticket always decides alone and its holder learns nothing.
 */
export function keepsTicketError(error: unknown): boolean {
  return !isKeelwerkError(error) || error.kind === 'internal' || error.kind === 'unavailable';
}
