import type { EffectStatus } from '@keelwerk/core';
import type { EffectReferences } from './effect-references.ts';
import type { RemoteClientState } from './remote-client-state.ts';
import { settleRemoteEffects } from './settle-remote-effects.ts';

/**
 * `AppClient.waitForEffects` (16.8.4): a timeout resolves the statuses as they stand, some of them still
 * `requested`; an id whose status has not arrived when it comes is left out of the result, so results are
 * matched by their `id`. Ids that no watch has a status for reject with `core.not_found`, naming how many.
 */
export async function waitForEffects(
  state: RemoteClientState,
  ids: EffectReferences,
  options: { readonly timeoutMs?: number; readonly signal?: AbortSignal },
): Promise<readonly EffectStatus[]> {
  return (await settleRemoteEffects(state, ids, options)).statuses;
}
