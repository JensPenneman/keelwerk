import type { KeelwerkError } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';

/** The one answer for a ticket that is not accepted, whatever the reason: unauthenticated `core.ticket_invalid`. */
export function ticketInvalid(): KeelwerkError {
  return coreError('core.ticket_invalid');
}
