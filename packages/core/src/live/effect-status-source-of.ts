import type { EffectStatus } from '../effects/effect-status.ts';
import { errors } from '../errors/errors.ts';
import type { LiveSource } from '../model/live-source.ts';
import { distinctEffectIds } from './distinct-effect-ids.ts';
import type { LiveEffectStatusSource } from './live-effect-status-source.ts';

/**
 * What `core.effectStatusWatch` returns from its source: `{ kind: 'liveSource', source:
 * LiveEffectStatusSource }` over the distinct ids. No id or more than 100 is `validation`.
 */
export function effectStatusSourceOf(ids: readonly string[]): LiveSource<EffectStatus> {
  const distinct = distinctEffectIds(ids);
  if (distinct === undefined) {
    throw errors.validation('The status watch follows 1 to 100 effects.', {
      issues: [{ path: ['ids'], message: 'Between 1 and 100 ids.' }],
    });
  }
  const source: LiveEffectStatusSource = { kind: 'effectStatus', ids: distinct };
  return { kind: 'liveSource', source };
}
