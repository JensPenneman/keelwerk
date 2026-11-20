import type { Scope } from '../storage/scope.ts';
import { deriveEffectId } from './derive-effect-id.ts';

/**
 * The id of the `index`-th inline effect `prepare` performs. Its cause is `prepare:<commandId>`, so
 * it never meets the id of a deferred effect of the same command at the same index.
 */
export function inlineEffectId(scope: Scope, commandId: string, index: number): string {
  return deriveEffectId(scope, `prepare:${commandId}`, index);
}
