import { KeelwerkError } from '../errors/keelwerk-error.ts';

/** An inline effect requested while the command's unit is open (section 7.9.4, phase 5). */
export function refuseEffectInUnit(): Promise<never> {
  return Promise.reject(
    new KeelwerkError({
      kind: 'internal',
      code: 'core.effect_in_unit',
      message: 'An inline effect was requested inside the command unit; it runs after the commit.',
    }),
  );
}
