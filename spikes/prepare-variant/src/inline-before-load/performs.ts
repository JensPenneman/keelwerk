import type { EffectDraft, EffectOutcome, PerformRequest } from '@keelwerk/core';

/** The member the variant adds to the context of `decide`. */
export interface Performs {
  perform<O>(effect: EffectDraft<O>): PerformRequest<EffectOutcome<O>>;
}

/**
 * Types `ctx.perform` on the decide context. The variant's driver installs the member at run time;
 * the context type of `defineCommand` does not carry it, so a command opts in here.
 */
export function performs<C extends object>(ctx: C): C & Performs {
  return ctx as C & Performs;
}
