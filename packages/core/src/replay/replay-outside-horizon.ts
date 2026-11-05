import { KeelwerkError } from '../errors/keelwerk-error.ts';

/**
 * The refusal of a state read in a decision older than the feed horizon (section 15.1.10): the
 * transient records that would answer it are purged. Replay's own limit, not a failure of the
 * handler.
 */
export function replayOutsideHorizon(entity: string): KeelwerkError {
  return new KeelwerkError({
    kind: 'unsupported',
    code: 'core.replay_outside_horizon',
    message: `${entity} keeps its change records for the feed horizon only, and the decision is older than that.`,
    details: { replay: 'unsupported', entity },
  });
}
