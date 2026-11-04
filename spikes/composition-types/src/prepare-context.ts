import type { DecideContext } from './decide-context.ts';
import type { EffectDraft } from './decision.ts';
import type { AnyModuleBase } from './define-module-base.ts';
import type { EffectOutcome } from './effect-outcome.ts';
import type { PrincipalKind } from './principal.ts';
import type { Request } from './request.ts';

/** The context of `prepare`: the decide context plus inline effects (section 7.9.4). */
export interface PrepareContext<
  B extends AnyModuleBase,
  W = readonly [],
  Pk extends PrincipalKind = PrincipalKind,
> extends DecideContext<B, W, undefined, Pk> {
  perform<O>(effect: EffectDraft<O>): Request<EffectOutcome<O>>;
}
