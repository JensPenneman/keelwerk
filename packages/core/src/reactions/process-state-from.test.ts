import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { processStateFrom } from './process-state-from.ts';

/** An `evolve` whose source text is fixed, so the digest does not depend on how the test is compiled. */
const evolveWith = (text: string) => Object.assign(() => undefined, { toString: () => text });

const reaction = {
  id: 'logs.tally',
  events: ['reset', 'noted'],
  initial: { count: 0 },
  evolve: evolveWith('evolve-text'),
} as never;

const digestOf = (text: string): string => createHash('sha256').update(text).digest('hex');

describe('what a process state cache is built from', () => {
  test('golden: the digest of a fixed process and build', () => {
    // The canonical text, written out by hand: members in name order, event names sorted.
    const canonical =
      '{"build":"build-1","events":["noted","reset"],"evolve":"evolve-text","initial":{"count":0},"process":"logs.tally"}';
    expect(processStateFrom(reaction, 'build-1')).toBe(digestOf(canonical));
    expect(processStateFrom(reaction, 'build-1')).toBe(
      'e9dd2f922efd4282cfe65ead76ca0b6886ce0d93194f9e5890efd549838b56a3',
    );
  });

  test('another build, evolve text, initial or event list gives another digest', () => {
    const base = processStateFrom(reaction, 'build-1');
    const others = [
      processStateFrom(reaction, 'build-2'),
      processStateFrom(
        { ...(reaction as object), evolve: evolveWith('other') } as never,
        'build-1',
      ),
      processStateFrom({ ...(reaction as object), initial: { count: 1 } } as never, 'build-1'),
      processStateFrom({ ...(reaction as object), events: ['noted'] } as never, 'build-1'),
      processStateFrom({ ...(reaction as object), id: 'logs.other' } as never, 'build-1'),
    ];
    expect(new Set([base, ...others]).size).toBe(6);
  });

  test('the order the events are declared in does not change the digest', () => {
    const reordered = { ...(reaction as object), events: ['noted', 'reset'] } as never;
    expect(processStateFrom(reordered, 'build-1')).toBe(processStateFrom(reaction, 'build-1'));
  });

  test('an initial that is no plain JSON gives no digest, and neither does a missing evolve', () => {
    const withInitial = (initial: unknown) =>
      processStateFrom({ ...(reaction as object), initial } as never, 'build-1');
    expect(withInitial(undefined)).toBeUndefined();
    expect(withInitial({ run: () => 1 })).toBeUndefined();
    expect(withInitial(new Map())).toBeUndefined();
    expect(withInitial({ n: Number.NaN })).toBeUndefined();
    expect(withInitial('ok')).toBeDefined();
    const { evolve: _evolve, ...bare } = reaction as unknown as Record<string, unknown>;
    expect(processStateFrom(bare as never, 'build-1')).toBeUndefined();
  });

  test('an evolve whose text is no code of its own gives no digest: a bound or native function', () => {
    // Bound to a config, a function stringifies to `[native code]` whatever the config is, so its
    // text cannot tell one deploy from another.
    const withEvolve = (value: unknown) =>
      processStateFrom({ ...(reaction as object), evolve: value } as never, 'build-1');
    const reducer = (_config: string, state: unknown) => state;
    expect(withEvolve(reducer.bind(null, 'config'))).toBeUndefined();
    expect(withEvolve(Math.max)).toBeUndefined();
    expect(withEvolve(() => undefined)).toBeDefined();
  });
});
