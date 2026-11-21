import { KeelwerkError } from '../errors/keelwerk-error.ts';

/**
 * The refusal of a run that was admitted on the receipt of its command id (`replayOnly`) when that
 * receipt is gone by the time the run would have to start something: retryable, and the retry takes
 * the full path.
 */
export function receiptGone(): KeelwerkError {
  return new KeelwerkError({
    kind: 'conflict',
    code: 'core.command_in_progress',
    message: 'The receipt of this command expired while it was replayed: send it again.',
    retryable: true,
  });
}
