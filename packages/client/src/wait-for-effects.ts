import type { EffectStatus } from '@keelwerk/core';
import type { EffectReferences } from './effect-references.ts';
import type { RemoteClientState } from './remote-client-state.ts';
import { settleRemoteEffects } from './settle-remote-effects.ts';

/** `AppClient.waitForEffects`: a timeout resolves the statuses as they stand, some of them still `requested`. */
export async function waitForEffects(
  state: RemoteClientState,
  ids: EffectReferences,
  options: { readonly timeoutMs?: number; readonly signal?: AbortSignal },
): Promise<readonly EffectStatus[]> {
  return (await settleRemoteEffects(state, ids, options)).statuses;
}
