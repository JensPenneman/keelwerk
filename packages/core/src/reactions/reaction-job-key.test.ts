import { describe, expect, test } from 'vitest';
import { noteEvent, reactionOf, reactionRegistry } from '../../test/reaction-kit.ts';
import { reactionJobKey } from './reaction-job-key.ts';
import { reactionKeyValue } from './reaction-key-value.ts';

const registry = reactionRegistry();
const event = noteEvent();

// Golden vectors of the stored format `<reaction id>:<sha256 of the part>`: no part is in the clear.
const hashOf = {
  chan: '2466fcafe0531db08547f61d39bd340224e92f3410d58837e04cb845d790b970',
  event: '51f0795c66a2052f73bfd111020b40d6b47ee782384989f08de94c524fad9571',
  stream: '54ce01b2d07c11ee09590c2dd42f6e98736a3b3ecff8ada59b7fc0d508e28bcc',
};

describe('the key of a reaction job', () => {
  test('golden: the reaction id, a colon and the sha256 of the part', () => {
    expect(reactionKeyValue({ id: 'logs.tally' }, 'chan')).toBe(`logs.tally:${hashOf.chan}`);
  });

  test('a reaction without ordering keeps one job per event, whatever key it declares', () => {
    expect(reactionJobKey(reactionOf(registry, 'plain'), event, 'ignored')).toEqual({
      value: `logs.plain:${hashOf.event}`,
      onConflict: 'keep',
    });
  });

  test('a coalescing reaction replaces the pending job of its key', () => {
    expect(reactionJobKey(reactionOf(registry, 'latest'), event, 'chan')).toEqual({
      value: `logs.latest:${hashOf.chan}`,
      onConflict: 'replace',
    });
  });

  test('a FIFO reaction appends to the queue of its key, else of the event stream', () => {
    const ordered = reactionOf(registry, 'ordered');
    expect(reactionJobKey(ordered, event, 'chan')).toEqual({
      value: `logs.ordered:${hashOf.chan}`,
      onConflict: 'append',
    });
    expect(reactionJobKey(ordered, event, undefined)).toEqual({
      value: `logs.ordered:${hashOf.stream}`,
      onConflict: 'append',
    });
  });

  test('the declared key never appears in the clear', () => {
    const key = reactionJobKey(reactionOf(registry, 'ordered'), event, 'ada@example.com');
    expect(key.value).not.toContain('example');
    expect(key.value).toMatch(/^logs\.ordered:[0-9a-f]{64}$/);
  });
});
