import type { StreamAppend, Unit } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { id } from './support/id.ts';
import { openMemory } from './support/memory-fixture.ts';
import { newEvent } from './support/new-event.ts';
import { storeSuite } from './support/store-suite.ts';
import { tenantScope } from './support/tenant-scope.ts';

type Run = <T>(fn: (unit: Unit) => Promise<T>) => Promise<T>;

const gate = (): { readonly promise: Promise<void>; readonly open: () => void } => {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { promise, open: () => resolve() };
};

/** The cases every SQL and in-memory adapter shares: a unit that has ended refuses (the fence). */
function unitEndCases(run: Run): void {
  const refused = { kind: 'internal', code: 'core.internal' };
  let count = 0;
  let stream = { type: 'app.note', id: id(1) };
  // A fresh stream for each test, so a late append that got through shows as an event of its own.
  const fresh = (): void => {
    count += 1;
    stream = { type: 'app.note', id: id(100 + count) };
  };
  const stored = async (unit: Unit): Promise<number> =>
    (await unit.events.readStream(stream)).length;
  const append = async (unit: Unit, version: number): Promise<void> => {
    await unit.events.append([
      { stream, expectedVersion: version, partition: null, events: [newEvent(version + 1)] },
    ]);
  };

  test('a unit used after it committed refuses every statement and changes nothing', async () => {
    fresh();
    let kept: Unit | undefined;
    await run(async (unit) => {
      kept = unit;
      await append(unit, 0);
    });
    const ended = kept;
    if (ended === undefined) throw new Error('the unit was not captured');
    await expect(stored(ended)).rejects.toMatchObject(refused);
    await expect(append(ended, 1)).rejects.toMatchObject(refused);
    await expect(ended.nested((inner) => stored(inner))).rejects.toMatchObject(refused);
    expect(await run(stored)).toBe(1);
  });

  test('work that resumes after its unit committed writes nothing', async () => {
    fresh();
    const resume = gate();
    let late: Promise<void> | undefined;
    await run(async (unit) => {
      await append(unit, 0);
      late = resume.promise.then(() => append(unit, 1));
      late.catch(() => undefined);
    });
    resume.open();
    await expect(late).rejects.toMatchObject(refused);
    expect(await run(stored)).toBe(1);
  });

  test('work that resumes after its unit failed reaches no later unit', async () => {
    fresh();
    const resume = gate();
    let late: Promise<void> | undefined;
    await expect(
      run(async (unit) => {
        late = resume.promise.then(() => append(unit, 0));
        late.catch(() => undefined);
        throw new Error('the deadline passed');
      }),
    ).rejects.toThrow('the deadline passed');
    await run(async (unit) => {
      resume.open();
      await expect(late).rejects.toMatchObject(refused);
      expect(await stored(unit)).toBe(0);
      await append(unit, 0);
    });
    expect(await run(stored)).toBe(1);
  });

  test('a savepoint that resumes after its unit ended is refused', async () => {
    fresh();
    const resume = gate();
    let late: Promise<unknown> | undefined;
    await run(async (unit) => {
      late = unit.nested(async (inner) => {
        await resume.promise;
        await append(inner, 0);
      });
      late.catch(() => undefined);
    });
    resume.open();
    await expect(late).rejects.toMatchObject(refused);
    expect(await run(stored)).toBe(0);
  });
}

describe('memory', () => {
  const memory = openMemory();
  unitEndCases((fn) => memory.run(tenantScope, fn));
});

describe('pglite', () => {
  const store = storeSuite();
  unitEndCases((fn) => store.run(tenantScope, fn));

  test('a statement of abandoned work that is sent while the commit tail runs is refused', async () => {
    const resume = gate();
    const stream = { type: 'app.note', id: id(900) };
    const eventsOf = (unit: Unit): Promise<number> =>
      unit.events.readStream(stream).then((found) => found.length);
    let late: Promise<unknown> | undefined;
    let during: number | undefined;
    await store.run(tenantScope, async (unit) => {
      late = resume.promise.then(() => eventsOf(unit));
      late.catch(() => undefined);
      unit.beforeCommit(async () => {
        // The tail's own statements pass; the abandoned work's statement sent now does not.
        resume.open();
        await late?.catch(() => undefined);
        during = await eventsOf(unit);
      });
    });
    await expect(late).rejects.toMatchObject({ kind: 'internal', code: 'core.internal' });
    expect(during).toBe(0);
  });

  test('an append of abandoned work that arrives while the commit tail runs is refused and not written', async () => {
    const resume = gate();
    const stream = { type: 'app.note', id: id(901) };
    const eventAt = (version: number): StreamAppend => ({
      stream,
      expectedVersion: version - 1,
      partition: null,
      events: [newEvent(version)],
    });
    let late: Promise<unknown> | undefined;
    await store.run(tenantScope, async (unit) => {
      await unit.events.append([eventAt(1)]);
      late = resume.promise.then(() => unit.events.append([eventAt(2)]));
      late.catch(() => undefined);
      unit.beforeCommit(async () => {
        resume.open();
        await late?.catch(() => undefined);
      });
    });
    await expect(late).rejects.toMatchObject({ kind: 'internal', code: 'core.internal' });
    expect(await store.run(tenantScope, (unit) => unit.events.readStream(stream))).toHaveLength(1);
  });

  test('a savepoint abandoned by its unit that fails while the commit tail runs takes nothing back from the tail', async () => {
    const resume = gate();
    const stream = { type: 'app.note', id: id(902) };
    let branch: Promise<unknown> | undefined;
    await store.run(tenantScope, async (unit) => {
      branch = unit.nested(async () => {
        await resume.promise;
      });
      branch.catch(() => undefined);
      await unit.events.append([
        { stream, expectedVersion: 0, partition: null, events: [newEvent(1)] },
      ]);
      unit.beforeCommit(async () => {
        resume.open();
        await branch?.catch(() => undefined);
      });
    });
    await expect(branch).rejects.toMatchObject({ kind: 'internal', code: 'core.internal' });
    expect(await store.run(tenantScope, (unit) => unit.events.readStream(stream))).toHaveLength(1);
  });

  test('a savepoint the unit abandoned that fails after the unit ended leaves the afterCommit callbacks registered later', async () => {
    const resume = gate();
    let branch: Promise<unknown> | undefined;
    const ran: string[] = [];
    await store.run(tenantScope, async (unit) => {
      branch = unit.nested(async () => {
        await resume.promise;
        throw new Error('the abandoned branch failed');
      });
      branch.catch(() => undefined);
      // Registered after the branch began, by the unit that goes on without it.
      unit.afterCommit(() => {
        ran.push('application hook');
      });
      unit.beforeCommit(async () => {
        resume.open();
        await branch?.catch(() => undefined);
      });
    });
    await expect(branch).rejects.toBeInstanceOf(Error);
    expect(ran).toEqual(['application hook']);
  });

  test('work that the commit tail started and did not await is refused once the unit has committed', async () => {
    const resume = gate();
    const stream = { type: 'app.note', id: id(903) };
    let late: Promise<unknown> | undefined;
    await store.run(tenantScope, async (unit) => {
      unit.beforeCommit(async () => {
        late = resume.promise.then(() => unit.events.readStream(stream));
        late.catch(() => undefined);
      });
    });
    resume.open();
    await expect(late).rejects.toMatchObject({ kind: 'internal', code: 'core.internal' });
  });
});
