import type { EffectStatus } from '../effects/effect-status.ts';
import { errors } from '../errors/errors.ts';
import type { LiveSource } from '../model/live-source.ts';
import type { LiveEffectStatusSource } from './live-effect-status-source.ts';

/** The most effects one status watch follows: below the hub's default `maxBufferedItems` of 1000, so a snapshot fits a subscriber's queue. */
const maxIds = 100;

/**
 * What `core.effectStatusWatch` returns from its source: `{ kind: 'liveSource', source:
 * LiveEffectStatusSource }` over the distinct ids. No id or more than 100 is `validation`.
 */
export function effectStatusSourceOf(ids: readonly string[]): LiveSource<EffectStatus> {
  const distinct = [...new Set(ids)];
  if (distinct.length < 1 || distinct.length > maxIds) {
    throw errors.validation('The status watch follows 1 to 100 effects.', {
      issues: [{ path: ['ids'], message: 'Between 1 and 100 ids.' }],
    });
  }
  const source: LiveEffectStatusSource = { kind: 'effectStatus', ids: distinct };
  return { kind: 'liveSource', source };
}
