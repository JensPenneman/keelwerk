import type { EffectScene } from '../effects/effect-scene.ts';
import type { AnyEffect } from '../protocol/any-effect.ts';

/** The effects one reaction's decision requested, with the scene to perform them in. */
export interface ReactionEffects {
  readonly scene: EffectScene;
  readonly effects: readonly AnyEffect[];
}
