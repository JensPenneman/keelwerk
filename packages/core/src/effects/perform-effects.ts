import type { AnyEffect } from '../protocol/any-effect.ts';
import { deriveEffectId } from './derive-effect-id.ts';
import type { EffectScene } from './effect-scene.ts';
import { recordExternalEffect } from './record-external-effect.ts';
import { refuseSettle } from './refuse-settle.ts';
import { runEnqueueEffect } from './run-enqueue-effect.ts';
import { runInvokeEffect } from './run-invoke-effect.ts';
import { runTimerEffects } from './run-timer-effects.ts';

/**
 * Performs one decision's effects in order, in the unit (section 7.9.4, phase 6), and answers the
 * ids of its external effects. Each effect's id derives from the scope, the scene's cause and its
 * index among the decision's effects.
 */
export async function performEffects(
  scene: EffectScene,
  effects: readonly AnyEffect[],
): Promise<readonly string[]> {
  const deferred: string[] = [];
  for (const [index, effect] of effects.entries()) {
    const id = deriveEffectId(scene.run.scope, scene.cause, index);
    switch (effect.kind) {
      case 'invoke':
        deferred.push(...(await runInvokeEffect(scene, effect, id)));
        break;
      case 'enqueue':
        await runEnqueueEffect(scene, effect, id);
        break;
      case 'setTimer':
      case 'cancelTimer':
        await runTimerEffects(scene, effect, id);
        break;
      case 'settle':
        refuseSettle(effect);
        break;
      case 'external':
        await recordExternalEffect(scene, effect, id);
        deferred.push(id);
        break;
    }
  }
  return deferred;
}
