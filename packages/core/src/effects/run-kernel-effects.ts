import type { AnyEffect } from '../protocol/any-effect.ts';
import type { Unit } from '../storage/unit.ts';

/** What the kernel effects of one decision run with. */
export interface KernelEffectsInput {
  readonly unit: Unit;
  readonly effects: readonly AnyEffect[];
  readonly commandId: string;
}

/**
 * Performs the kernel effects of a decision in order (section 7.9.4, phase 6) and returns the ids
 * of the deferred effects. The effects package fills this in; until then a decision's effects are
 * not performed and no id comes back.
 */
export async function runKernelEffects(_input: KernelEffectsInput): Promise<readonly string[]> {
  return [];
}
