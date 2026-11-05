import { KeelwerkError } from '../errors/keelwerk-error.ts';

/**
 * The refusal of a re-decide whose handler needs a key that no longer exists (a destroyed value
 * key, a retired scope key): the verification or reveal it made cannot be reproduced. Replay's own
 * limit, not a failure of the handler.
 */
export function replayKeyDestroyed(what: string): KeelwerkError {
  return new KeelwerkError({
    kind: 'unsupported',
    code: 'core.replay_key_destroyed',
    message: `${what} needs a key that was destroyed, so the decision cannot be re-decided.`,
    details: { replay: 'unsupported' },
  });
}
