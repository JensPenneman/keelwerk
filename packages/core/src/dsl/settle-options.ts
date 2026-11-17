import type { PlainEffectInputOf } from '../effects/plain-effect-input-of.ts';
import type { Where } from '../model/where.ts';
import type { AnyEffectPart } from './define-effect.ts';

/**
 * The third parameter of `settle`: the effect the id must be of and the performer's `where` (7.9.5,
 * 15.4.11).
 */
export interface SettleOptions<E extends AnyEffectPart> {
  /** An own effect with an outside performer: an id of another effect answers `not_found`. */
  readonly effect: E;
  /**
   * The `where` of `ctx.live.effects(effect, { where })`: an effect whose plain input does not
   * match answers `not_found`, as an unknown id. Build it from the principal (`ctx.principal`),
   * never from the command's input: a value the caller chooses ties nothing.
   */
  readonly where?: Where<PlainEffectInputOf<E>>;
}
