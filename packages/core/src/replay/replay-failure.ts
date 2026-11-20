import type { KeelwerkError } from '../errors/keelwerk-error.ts';

const refusals: ReadonlySet<string> = new Set([
  'core.replay_outside_horizon',
  'core.replay_key_destroyed',
]);

function isReplay(error: KeelwerkError, kind: 'mismatch' | 'unsupported'): boolean {
  return (
    typeof error.details === 'object' &&
    error.details !== null &&
    'replay' in error.details &&
    error.details.replay === kind
  );
}

/** How a re-decide reports an error of its run: a difference, or a refusal with its code. */
export function replayFailure(error: KeelwerkError): {
  readonly message: string;
  readonly refused?: string;
} {
  if (isReplay(error, 'mismatch')) return { message: error.message };
  if (isReplay(error, 'unsupported')) {
    return {
      message: `cannot re-decide: ${error.message}`,
      ...(refusals.has(error.code) ? { refused: error.code } : {}),
    };
  }
  return { message: `the handler now fails with ${error.code}: ${error.message}` };
}
