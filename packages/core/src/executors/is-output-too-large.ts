import { isKeelwerkError } from '../errors/is-keelwerk-error.ts';

/**
 * Whether an error is the refusal of an output over the size an effect record keeps. It is the
 * sheet's own failure of the attempt: the destination is not known to have acted on it, unlike any
 * other kernel error that takes the answer.
 */
export function isOutputTooLarge(error: unknown): boolean {
  return isKeelwerkError(error) && error.code === 'core.effect_output_too_large';
}
