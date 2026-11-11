import { describe, expect, test } from 'vitest';
import type { Meter } from '../observability/meter.ts';
import { countReactionFault } from './count-reaction-fault.ts';

describe('counting a reaction fault', () => {
  test('adds one to keelwerk.reactions.faults with the kind and the reaction id', () => {
    const added: unknown[] = [];
    const meter = {
      createCounter: (name: string) => ({
        add: (value: number, attributes: unknown) => added.push([name, value, attributes]),
      }),
    } as unknown as Meter;
    countReactionFault('event_purged', 'logs.plain', meter);
    countReactionFault('long_fold', 'logs.tally', meter);
    expect(added).toEqual([
      ['keelwerk.reactions.faults', 1, { fault: 'event_purged', reaction: 'logs.plain' }],
      ['keelwerk.reactions.faults', 1, { fault: 'long_fold', reaction: 'logs.tally' }],
    ]);
  });
});
