import { errors } from '../errors/errors.ts';
import type { NormalizerEntry } from './normalizer-registry.ts';
import type { PersonalDeclaration } from './personal-declaration.ts';
import type { SealingContext } from './sealing-context.ts';

/** The normaliser a personal field names; an unregistered one is an internal error, never a silent `exact`. */
export function normalizerOf(
  context: Pick<SealingContext, 'normalizers'>,
  personal: PersonalDeclaration,
): NormalizerEntry {
  const found = context.normalizers.resolve(personal.normalize);
  if (found === undefined) {
    throw errors.internal(
      `The normaliser ${personal.normalize.id}@${personal.normalize.version} is not registered.`,
    );
  }
  return found;
}
