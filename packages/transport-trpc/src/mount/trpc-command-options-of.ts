import { coreError } from '@keelwerk/core/http';

/**
 * The command options of a request (decisions D1 and 16.4.8): the `Idempotency-Key` as the
 * command id, kept opaque for the checks of the procedure, and `Prefer` naming `respond-async` as
 * the execution preference. One header cannot name several commands, so a key or `Prefer:
 * respond-async` on a request of more than one call is refused: the answer of a batch carries no
 * `Preference-Applied` and no command id, so a caller could not tell which command ran as asked.
 */
export function trpcCommandOptionsOf(
  headers: Headers,
  calls: number,
): { readonly commandId?: string; readonly prefer?: 'async' } {
  const key = headers.get('idempotency-key')?.trim();
  const commandId = key === undefined || key === '' ? undefined : key;
  if (commandId !== undefined && calls !== 1) {
    throw coreError('core.malformed_request', {
      message: 'An Idempotency-Key names one command: send it with a request of one call.',
    });
  }
  const asynchronous = (headers.get('prefer') ?? '')
    .split(',')
    .some((token) => token.split(';')[0]?.trim().toLowerCase() === 'respond-async');
  if (asynchronous && calls !== 1) {
    throw coreError('core.malformed_request', {
      message: 'Prefer: respond-async applies to one command: send it with a request of one call.',
    });
  }
  return {
    ...(commandId === undefined ? {} : { commandId }),
    ...(asynchronous ? { prefer: 'async' as const } : {}),
  };
}
