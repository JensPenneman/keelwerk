import type { EffectOutcome } from '@keelwerk/core';

/** One line of the stub's effect log: the `requested` record, then the `settled` record of the same effect. */
export type EffectRecord =
  | {
      readonly phase: 'requested';
      readonly id: string;
      readonly type: string;
      readonly input: unknown;
    }
  | {
      readonly phase: 'settled';
      readonly id: string;
      readonly outcome: EffectOutcome<unknown>;
    };
