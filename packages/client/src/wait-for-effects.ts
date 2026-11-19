import type { EffectStatus, LiveFrame } from '@keelwerk/core';
import { clientFailure } from './client-failure.ts';
import type { EffectReferences } from './effect-references.ts';
import type { RemoteClientState } from './remote-client-state.ts';
import { settleEffects } from './settle-effects.ts';
import { subscribeRemote } from './subscribe-remote.ts';

/**
 * `AppClient.waitForEffects` (16.8.4): `settleEffects` over `core.effectStatusWatch`. The ids are the
 * raw UUIDs an answer lists; the surface renders them, and the decoded statuses carry the UUIDs back.
 * Ids no watch had a status for (not requested by the caller, or unknown) reject `core.not_found`
 * naming how many; a timeout resolves the statuses as they stand, some of them still `requested`.
 */
export async function waitForEffects(
  state: RemoteClientState,
  ids: EffectReferences,
  options: { readonly timeoutMs?: number; readonly signal?: AbortSignal },
): Promise<readonly EffectStatus[]> {
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
  return settling.statuses;
}
