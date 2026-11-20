import type { AnyModuleBase } from '../model/any-module-base.ts';
import type { EffectOutcome } from '../model/effect-outcome.ts';
import type { PrincipalKind } from '../principals/principal-kind.ts';
import type { EffectDraft } from '../protocol/effect-draft.ts';
import type { PerformRequest } from '../protocol/perform-request.ts';
import type { DecideContext } from './decide-context.ts';

/**
 * The context of `prepare`: the decide context plus inline effects (section 7.9.4): each
 * `ctx.perform` runs the effect's inline executor outside any unit and answers its outcome.
 */
export interface PrepareContext<
  B extends AnyModuleBase,
  W = readonly [],
  Pk extends PrincipalKind = PrincipalKind,
> extends DecideContext<B, W, undefined, Pk> {
  perform<O>(effect: EffectDraft<O>): PerformRequest<EffectOutcome<O>>;
}
