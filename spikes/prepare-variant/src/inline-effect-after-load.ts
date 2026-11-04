import { KeelwerkError } from '@keelwerk/core';

/** The refusal of an inline effect requested after the first load of `decide` (proposed code `core.effect_after_load`). */
export function inlineEffectAfterLoad(effectType: string, action: string): KeelwerkError {
  return new KeelwerkError({
    kind: 'internal',
    code: 'core.effect_after_load',
    message: `${action} requested the inline effect ${effectType} after its first load; inline effects belong before the first load of decide.`,
    details: { effect: effectType, action },
  });
}
