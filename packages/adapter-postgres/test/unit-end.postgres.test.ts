import type { Unit } from '@keelwerk/core';
import { CompiledQuery } from 'kysely';
import { describe, expect, test } from 'vitest';
import { streamAppend } from './support/event-fixtures.ts';
import { eventHarness } from './support/event-harness.ts';
import { id } from './support/store-rows.ts';
import { testNamespace } from './support/test-namespace.ts';
import { testScopes } from './support/test-scopes.ts';

const { scopeA } = testScopes;
const refused = { kind: 'internal', code: 'core.internal' };
// One connection: the unit after an abandoned one reuses the connection the abandoned work holds.
const { run, adapter } = eventHarness('unit_end', 1);

const gate = (): { readonly promise: Promise<void>; readonly open: () => void } => {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { promise, open: () => resolve() };
};

// The events of the stream, as a later unit reads them: a late append that got through adds one.
const stored = async (unit: Unit): Promise<number> =>
  (await unit.events.readStream({ type: 'app.ticket', id: id(1) })).length;
const append = async (unit: Unit, version: number): Promise<void> => {
  await unit.events.append([streamAppend(1, [version + 1], version)]);
};

describe('a unit that has ended', () => {
  test('refuses every statement and changes nothing', async () => {
    let kept: Unit | undefined;
    await run(scopeA, async (unit) => {
      kept = unit;
      await append(unit, 0);
    });
    const ended = kept;
    if (ended === undefined) throw new Error('the unit was not captured');
    await expect(stored(ended)).rejects.toMatchObject(refused);
    await expect(append(ended, 1)).rejects.toMatchObject(refused);
    await expect(ended.nested((inner) => stored(inner))).rejects.toMatchObject(refused);
    expect(await run(scopeA, stored)).toBe(1);
  });

  test('work that resumes after its unit failed reaches neither the pool nor the next unit', async () => {
    const resume = gate();
    let late: Promise<void> | undefined;
    await expect(
      run(scopeA, async (unit) => {
        late = resume.promise.then(() => append(unit, 0));
        late.catch(() => undefined);
        throw new Error('the deadline passed');
      }),
    ).rejects.toThrow('the deadline passed');
    await run(scopeA, async (unit) => {
      resume.open();
      await expect(late).rejects.toMatchObject(refused);
      expect(await stored(unit)).toBe(0);
      await append(unit, 0);
    });
    expect(await run(scopeA, stored)).toBe(1);
  });

  test('a savepoint that resumes after its unit ended is refused', async () => {
    const resume = gate();
    let late: Promise<unknown> | undefined;
    await run(scopeA, async (unit) => {
      late = unit.nested(async (inner) => {
        await resume.promise;
        await append(inner, 0);
      });
      late.catch(() => undefined);
    });
    resume.open();
    await expect(late).rejects.toMatchObject(refused);
    expect(await run(scopeA, stored)).toBe(0);
  });

  test('a savepoint the unit abandoned that fails after the unit ended leaves the afterCommit callbacks registered later', async () => {
    const resume = gate();
    let branch: Promise<unknown> | undefined;
    const ran: string[] = [];
    await adapter().session(testNamespace, scopeA, async (session) => {
      branch = session.nested(async () => {
        await resume.promise;
        throw new Error('the abandoned branch failed');
      });
      branch.catch(() => undefined);
      session.afterCommit(() => {
        ran.push('application hook');
      });
      session.beforeCommit(async () => {
        resume.open();
        await branch?.catch(() => undefined);
      });
    });
    await expect(branch).rejects.toBeInstanceOf(Error);
    expect(ran).toEqual(['application hook']);
  });

  test('work that the commit tail started and did not await is refused once the unit has committed', async () => {
    const resume = gate();
    let late: Promise<unknown> | undefined;
    await adapter().session(testNamespace, scopeA, async (session) => {
      session.beforeCommit(async () => {
        late = resume.promise.then(() => session.db.executeQuery(CompiledQuery.raw('select 1')));
        late.catch(() => undefined);
      });
    });
    resume.open();
    await expect(late).rejects.toMatchObject(refused);
  });
});
