import type { EffectStatus, LiveFrame } from '@keelwerk/core';
import { clientFailure } from './client-failure.ts';
import type { EffectReferences } from './effect-references.ts';
import type { EffectSettling } from './effect-settling.ts';
import type { RemoteClientState } from './remote-client-state.ts';
import { settleEffects } from './settle-effects.ts';
import { subscribeRemote } from './subscribe-remote.ts';

/**
 * The wait of `AppClient.waitForEffects` (16.8.4) with what it came to: `settleEffects` over
 * `core.effectStatusWatch`. The ids are the raw UUIDs an answer lists; the surface renders them, and
 * the decoded statuses carry the UUIDs back. Ids no watch had a status for (not requested by the
 * caller, or unknown) reject `core.not_found` naming how many. `settled` is false when the timeout or
 * the end of a watch came first, some statuses then still `requested`.
 */
export async function settleRemoteEffects(
  state: RemoteClientState,
  ids: EffectReferences,
  options: { readonly timeoutMs?: number; readonly signal?: AbortSignal },
): Promise<EffectSettling<EffectStatus>> {
  const settling = await settleEffects<EffectStatus>(
    (chunk) =>
      subscribeRemote(
        state,
        'core.effectStatusWatch',
        { ids: chunk },
        options.signal === undefined ? {} : { signal: options.signal },
      ) as AsyncIterable<LiveFrame<EffectStatus>>,
    ids,
    options,
  );
  if (settling.missing.length > 0) {
    throw clientFailure(
      'core.not_found',
      `${settling.missing.length} of the effects are not known to this caller.`,
    );
  }
  return settling;
}
