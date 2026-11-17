import type { Meter } from '@keelwerk/core';

/** What a counter was given: the instrument's name, the amount and the attributes. */
export interface Counted {
  readonly name: string;
  readonly value: number;
  readonly attributes: Readonly<Record<string, unknown>>;
}

/** A meter whose counters remember every `add` in `into`, in order. */
export function countingMeter(into: Counted[]): Meter {
  return {
    createCounter: (name: string) => ({
      add: (value: number, attributes: Readonly<Record<string, unknown>> = {}) => {
        into.push({ name, value, attributes });
      },
    }),
  } as unknown as Meter;
}
