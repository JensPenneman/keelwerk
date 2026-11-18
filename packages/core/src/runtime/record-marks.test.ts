import { describe, expect, test } from 'vitest';
import type { ScopeMark } from '../control/scope-mark.ts';
import type { ScopeCounters } from '../storage/scope-counters.ts';
import { createServiceGate } from './create-service-gate.ts';
import { recordMarks } from './record-marks.ts';

const scopeId = '0192f3a0-0000-7000-8000-000000000001';

/** A fake timer set: each sleep waits for `tick()`; the clock moves a minute with it. */
function setup(spread = false) {
  let ms = Date.parse('2026-11-17T10:00:00Z');
  const clock = { now: () => Temporal.Instant.fromEpochMilliseconds(ms) };
  const waiting: ((value: boolean) => void)[] = [];
  const timers = {
    sleepUntil: (_at: Temporal.Instant, signal: AbortSignal) =>
      new Promise<boolean>((resolve) => {
        if (signal.aborted) {
          resolve(false);
          return;
        }
        waiting.push(resolve);
        signal.addEventListener('abort', () => resolve(false), { once: true });
      }),
  };
  const positions = new Map<string, bigint>([
    ['ns-1', 5n],
    ['ns-2', 5n],
  ]);
  let timeline = '1';
  const errors: { message: string; fields: Record<string, unknown> }[] = [];
  const gate = createServiceGate();
  const written: ScopeMark[][] = [];
  let bumpedReads = 0;
  const stored = new Map<string, ScopeMark>();
  const bumps: { mark: ScopeMark; from: number; gateClosed: boolean }[] = [];
  let failBump = false;
  let hangBump = false;
  const warnings: string[] = [];
  const bumpTries: number[] = [];
  const control = {
    epochs: () => new Map<string, number>(),
    marks: {
      raise: async (marks: ScopeMark[]) => {
        written.push(marks);
        for (const mark of marks) {
          const key = `${mark.namespaceId}/${mark.scopeId}`;
          const known = stored.get(key);
          stored.set(key, {
            ...mark,
            epoch: known?.epoch ?? mark.epoch,
            position:
              known !== undefined && known.position > mark.position
                ? known.position
                : mark.position,
          });
        }
      },
      list: async (namespaceId: string) =>
        [...stored.values()].filter((mark) => mark.namespaceId === namespaceId),
      bump: async (mark: ScopeMark, from: number) => {
        bumpTries.push(bumpTries.length);
        if (hangBump) return new Promise<number>(() => undefined);
        if (failBump) throw new Error('the control store is down');
        bumps.push({ mark, from, gateClosed: gate.closed });
        return mark.epoch;
      },
      bumped: async () => {
        bumpedReads += 1;
        return [];
      },
    },
  };
  const sourceOf = (id: string) => ({
    namespace: { id },
    handle: {
      adapter: {
        identity: async () => ({ systemId: 'system-1', timeline }),
        unit: async (_ns: unknown, _scope: unknown, fn: (unit: unknown) => unknown) =>
          fn({
            counters: {
              list: async (): Promise<ScopeCounters[]> => [
                { scopeId, position: positions.get(id) ?? 0n, epoch: 1, serials: {} },
              ],
            },
          }),
      },
    },
  });
  const source = sourceOf('ns-1');
  const service = recordMarks({ clock, options: { timers }, gate } as never);
  const context = {
    control,
    namespaces: spread ? [source, sourceOf('ns-2')] : [source],
    signal: new AbortController().signal,
    log: {
      warn: (message: string) => warnings.push(message),
      error: (message: string, fields: Record<string, unknown>) => errors.push({ message, fields }),
    },
  };
  return {
    service,
    context,
    written,
    bumps,
    warnings,
    failBump: (on = true) => {
      failBump = on;
    },
    hangBump: () => {
      hangBump = true;
    },
    bumpTries: () => bumpTries.length,
    bumpedReads: () => bumpedReads,
    errors,
    gate,
    setPosition: (next: bigint, namespace = 'ns-1') => {
      positions.set(namespace, next);
    },
    setTimeline: (next: string) => {
      timeline = next;
    },
    tick: async () => {
      ms += 60_000;
      waiting.shift()?.(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

describe('the core.marks service', () => {
  test('records a mark for a moved scope each minute and nothing for an unchanged one', async () => {
    const kit = setup();
    await kit.service.start(kit.context as never);
    await kit.tick();
    expect(kit.written).toHaveLength(1);
    expect(kit.written[0]?.[0]).toMatchObject({
      scopeId,
      namespaceId: 'ns-1',
      position: 5n,
      epoch: 0,
    });
    await kit.tick();
    expect(kit.written).toHaveLength(1);
    kit.setPosition(9n);
    await kit.tick();
    expect(kit.written).toHaveLength(2);
    expect(kit.written[1]?.[0]?.position).toBe(9n);
    await kit.service.stop(Temporal.Now.instant().add({ seconds: 5 }));
  });

  test('records once more at stop and keeps the epoch cache current by reading the bumped marks', async () => {
    const kit = setup();
    await kit.service.start(kit.context as never);
    await kit.tick();
    expect(kit.bumpedReads()).toBe(1);
    kit.setPosition(12n);
    await kit.service.stop(Temporal.Now.instant().add({ seconds: 5 }));
    expect(kit.written.at(-1)?.[0]?.position).toBe(12n);
    expect(kit.bumpedReads()).toBe(2);
  });

  test('a position that falls below the last one seen takes the process out of service', async () => {
    const kit = setup();
    await kit.service.start(kit.context as never);
    kit.setPosition(9n);
    await kit.tick();
    expect(kit.gate.closed).toBe(false);
    kit.setPosition(7n);
    await kit.tick();
    expect(kit.gate.closed).toBe(true);
    expect(await kit.gate.whenClosed).toBe('position');
    expect(kit.errors).toHaveLength(1);
    expect(kit.errors[0]?.fields).toMatchObject({ reason: 'position', was: '9', now: '7' });
    // The rewind is made durable before the process exits: the mark moves above the counter's
    // epoch (1), from the stored epoch, keeping the highest position seen; the gate is already
    // closed while the bump is made.
    expect(kit.bumps).toHaveLength(1);
    expect(kit.bumps[0]).toMatchObject({
      mark: { scopeId, namespaceId: 'ns-1', epoch: 2, position: 9n },
      from: 0,
      gateClosed: true,
    });
    // Nothing is recorded once the process is out of service, at the next minute or at stop.
    const written = kit.written.length;
    kit.setPosition(20n);
    await kit.tick();
    await kit.service.stop(Temporal.Now.instant().add({ seconds: 5 }));
    expect(kit.written).toHaveLength(written);
  });

  test('a rewind takes the process out of service even when its epoch cannot be recorded', async () => {
    const kit = setup();
    await kit.service.start(kit.context as never);
    kit.setPosition(9n);
    await kit.tick();
    kit.failBump();
    kit.setPosition(7n);
    await kit.tick();
    expect(kit.gate.closed).toBe(true);
    expect(kit.bumps).toEqual([]);
    expect(kit.errors.map((line) => line.message)).toContain(
      'the epoch of a rewound scope could not be recorded: the process stays until it is',
    );
  });

  test('a rewind whose bump fails keeps the process until a later pass records it', async () => {
    const kit = setup();
    await kit.service.start(kit.context as never);
    kit.setPosition(9n);
    await kit.tick();
    kit.failBump();
    kit.setPosition(7n);
    await kit.tick();
    // Closed at once: the invoker refuses and the process is not ready. Not yet out of service.
    expect(kit.gate.closed).toBe(true);
    let settled = false;
    void kit.gate.outOfService.then(() => {
      settled = true;
    });
    await kit.tick();
    expect(kit.bumpTries()).toBe(2);
    expect(settled).toBe(false);
    expect(kit.bumps).toEqual([]);
    // The store takes the second bump: it is recorded and the process may leave.
    kit.failBump(false);
    await kit.tick();
    expect(await kit.gate.outOfService).toBe('position');
    expect(kit.bumps).toHaveLength(1);
    expect(kit.bumps[0]).toMatchObject({
      mark: { scopeId, namespaceId: 'ns-1', epoch: 2, position: 9n },
      gateClosed: true,
    });
    // Nothing is tried once it is recorded.
    await kit.tick();
    expect(kit.bumpTries()).toBe(3);
    await kit.service.stop(Temporal.Now.instant().add({ seconds: 5 }));
  });

  test('a bump that never answers does not keep the gate open', async () => {
    const kit = setup();
    await kit.service.start(kit.context as never);
    kit.setPosition(9n);
    await kit.tick();
    kit.hangBump();
    kit.setPosition(7n);
    // The pass stays in the bump: the gate is read while it is in flight.
    await kit.tick();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(kit.bumpTries()).toBe(1);
    expect(kit.gate.closed).toBe(true);
    let settled = false;
    void kit.gate.outOfService.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    await kit.service.stop(Temporal.Now.instant().add({ milliseconds: 50 }));
  });

  test('a scope in two namespaces at different positions is no rewind', async () => {
    const kit = setup(true);
    kit.setPosition(9n, 'ns-1');
    kit.setPosition(5n, 'ns-2');
    await kit.service.start(kit.context as never);
    await kit.tick();
    await kit.tick();
    expect(kit.gate.closed).toBe(false);
    expect(kit.bumps).toEqual([]);
    // Each namespace keeps its own memo: both marks were written, and nothing again at rest.
    expect(kit.written.flat().map((mark) => [mark.namespaceId, mark.position])).toEqual([
      ['ns-1', 9n],
      ['ns-2', 5n],
    ]);
    // A rewind of one namespace's own position is still found.
    kit.setPosition(4n, 'ns-2');
    await kit.tick();
    expect(kit.gate.closed).toBe(true);
    expect(kit.bumps[0]?.mark).toMatchObject({ namespaceId: 'ns-2', position: 5n });
    await kit.service.stop(Temporal.Now.instant().add({ seconds: 5 }));
  });

  test('a changed cluster identity takes the process out of service', async () => {
    const kit = setup();
    await kit.service.start(kit.context as never);
    await kit.tick();
    expect(kit.gate.closed).toBe(false);
    kit.setTimeline('2');
    await kit.tick();
    expect(kit.gate.closed).toBe(true);
    expect(await kit.gate.whenClosed).toBe('identity');
    expect(kit.errors[0]?.fields).toMatchObject({ reason: 'identity', namespace: 'ns-1' });
    await kit.service.stop(Temporal.Now.instant().add({ seconds: 5 }));
  });

  test('has the roles serve and work', () => {
    const kit = setup();
    expect(kit.service.id).toBe('core.marks');
    expect(kit.service.roles).toEqual(['serve', 'work']);
  });
});
