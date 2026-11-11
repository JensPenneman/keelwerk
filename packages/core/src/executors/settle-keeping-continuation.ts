import { isKeelwerkError } from '../errors/is-keelwerk-error.ts';
import type { Unit } from '../storage/unit.ts';
import { settleEffect } from './settle-effect.ts';

type SettleTarget = Parameters<typeof settleEffect>[1];
type Settled = Parameters<typeof settleEffect>[2];

/**
 * Settles an effect with its continuation, and without it only when the continuation cannot run
 * any more: it names a command the build no longer has (`internal`) or its input no longer fits
 * the command (`validation`). The first try is a nested unit, so a refusal takes the settled
 * record back with it; the second writes the same settlement with `continuation: 'skip'`. Every
 * other failure, a lost lease and a store error included, is rethrown: dropping a continuation
 * that is known and valid would make "the continuation runs once" into "never". `settled` is built
 * inside each try, in the unit that settles, so a value sealed for the output is rolled back with it.
 * Answers the settlement that was written, or undefined when the effect was no longer `requested`.
 */
export async function settleKeepingContinuation(
  unit: Unit,
  target: SettleTarget,
  settledOf: (unit: Unit) => Promise<Settled>,
  attempts: number,
): Promise<Settled | undefined> {
  const settle = async (inner: Unit, skip: boolean): Promise<Settled | undefined> => {
    const settled = await settledOf(inner);
    const written = await settleEffect(
      inner,
      skip ? { ...target, continuation: 'skip' } : target,
      settled,
      attempts,
    );
    return written ? settled : undefined;
  };
  if (target.continuation === 'skip' || target.entry === undefined) return settle(unit, true);
  try {
    return await unit.nested((nested) => settle(nested, false));
  } catch (error) {
    if (!isKeelwerkError(error) || (error.kind !== 'internal' && error.kind !== 'validation')) {
      throw error;
    }
    return settle(unit, true);
  }
}
