import { stateTokenKey } from '../tokens/state-token-key.ts';
import type { RunCommandInput } from './run-command-input.ts';

/**
 * The key that seals the state tokens of the scope a run writes in: the one `runCommand` derived
 * before its unit opened. A run that did not come through it derives it, which never opens a unit
 * there.
 */
export function stateSealKeyOf(run: RunCommandInput): Promise<Uint8Array> {
  return run.stateSealKey === undefined
    ? stateTokenKey(run.keys, run.scope)
    : Promise.resolve(run.stateSealKey);
}
