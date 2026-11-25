import type { Registry } from '@keelwerk/core';
import { env } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { doctorReadBounds } from '../../src/doctor/doctor-read-bounds.ts';
import { openControl } from '../../src/doctor/open-control.ts';
import { definitionOver, fakeControlStore } from '../support/fake-control-store.ts';
import { createFakeHost } from '../support/fake-host.ts';
import { stepTimers } from '../support/step-timers.ts';

const registry = {
  entities: new Map([['core.process', { descriptor: { ref: 'core.process' } }]]),
} as unknown as Registry;
const recorded = '0192f3a0-0000-7000-8000-000000000001';
const fake = createFakeHost();
const { schedule } = fake.host;

/** The reader of an open control store, or the failure of the case. */
async function readerOf(opened: Awaited<ReturnType<typeof openControl>>) {
  if (!opened.reader.known) throw new Error(opened.reader.reason);
  return opened.reader.value;
}

describe('opening the control store to read it', () => {
  test('the embedded adapter pglite is never created', async () => {
    const store = fakeControlStore({ id: 'pglite', recorded });
    const opened = await openControl(definitionOver(store), {}, [registry], schedule);
    expect(opened.reader).toMatchObject({ known: false });
    expect(opened.reader.known ? '' : opened.reader.reason).toContain('embedded');
    expect(store.created).toEqual([]);
  });

  test('a store of the memory dialect is never created', async () => {
    const store = fakeControlStore({ dialect: 'memory', recorded });
    const opened = await openControl(definitionOver(store), {}, [registry], schedule);
    expect(opened.reader).toMatchObject({ known: false });
    expect(store.created).toEqual([]);
  });

  test('a url that reads an unset variable, and a missing adapter, are reasons and nothing is created', async () => {
    const store = fakeControlStore({ recorded });
    const unset = await openControl(
      definitionOver(store, { adapter: 'fake', url: env('CONTROL_URL') }),
      {},
      [registry],
      schedule,
    );
    expect(unset.reader.known ? '' : unset.reader.reason).toContain('environment variable');
    const missing = await openControl(
      { ...definitionOver(store), infrastructure: [] },
      {},
      [registry],
      schedule,
    );
    expect(missing.reader.known ? '' : missing.reader.reason).toContain('no infrastructure entry');
    expect(store.created).toEqual([]);
  });

  test('no selected app means no descriptor to read with, and nothing is created', async () => {
    const store = fakeControlStore({ recorded });
    const opened = await openControl(definitionOver(store), {}, [], schedule);
    expect(opened.reader.known ? '' : opened.reader.reason).toContain('no app is selected');
    expect(store.created).toEqual([]);
  });

  test('a deployment that never started has no id: the probe is closed and the store is not opened again', async () => {
    const store = fakeControlStore();
    const opened = await openControl(definitionOver(store), {}, [registry], schedule);
    expect(opened.reader.known ? '' : opened.reader.reason).toContain('never started');
    expect(store.created).toHaveLength(1);
    expect(store.closed).toEqual([0]);
  });

  test('the recorded id opens the store a second time, read-only with the time limit, and close closes it', async () => {
    const store = fakeControlStore({ recorded });
    const opened = await openControl(definitionOver(store), {}, [registry], schedule);
    expect(store.created[1]).toBe(recorded);
    expect(store.closed).toEqual([0]);
    const reader = await readerOf(opened);
    expect(await reader.reachable()).toEqual({ reachable: true, detail: 'answered' });
    expect(store.units).toEqual([
      {
        level: { level: 'deployment' },
        options: { readOnly: true, timeoutMs: doctorReadBounds.unitTimeoutMs },
      },
    ]);
    await opened.close();
    expect(store.closed).toEqual([0, 1]);
  });

  test('a store that does not connect gives a reader that says so, with the adapter closed again', async () => {
    const store = fakeControlStore({
      recorded,
      connect: async (created) => {
        if (created === 1) throw new Error('connection refused');
      },
    });
    const opened = await openControl(definitionOver(store), {}, [registry], schedule);
    const reader = await readerOf(opened);
    expect(await reader.reachable()).toEqual({
      reachable: false,
      detail: 'control: connection refused',
    });
    await expect(reader.processes()).rejects.toThrow('control: connection refused');
    expect(store.closed).toEqual([0, 1]);
    await opened.close();
    expect(store.closed).toEqual([0, 1]);
  });

  test('a probe that does not connect gives the same, with the probe closed again', async () => {
    const store = fakeControlStore({
      recorded,
      connect: async () => {
        throw new Error('no route to host');
      },
    });
    const opened = await openControl(definitionOver(store), {}, [registry], schedule);
    const reader = await readerOf(opened);
    expect((await reader.reachable()).detail).toBe('control: no route to host');
    expect(store.created).toHaveLength(1);
    expect(store.closed).toEqual([0]);
  });

  test('a read of the recorded id that fails is a store that does not answer, never a deployment that never started', async () => {
    const store = fakeControlStore({ recorded, readFails: 'permission denied' });
    const opened = await openControl(definitionOver(store), {}, [registry], schedule);
    const reader = await readerOf(opened);
    expect(await reader.reachable()).toEqual({ reachable: false, detail: 'permission denied' });
    expect(store.closed).toEqual([0]);
  });

  test('a read of the recorded id that never answers ends at its deadline as a store that does not answer, and the probe is closed without being waited for', async () => {
    const store = fakeControlStore({ recorded, silent: ['history', 'close'] });
    const opened = await stepTimers(
      fake,
      openControl(definitionOver(store), {}, [registry], schedule),
      store.asked,
      50,
    );
    const reader = await readerOf(opened);
    expect((await reader.reachable()).reachable).toBe(false);
    expect(store.closed).toEqual([0]);
    expect(store.closing).toEqual([0]);
    expect(store.created).toHaveLength(1);
  });

  test('a unit that never answers fails its fact at the deadline, and a close that never answers does not hold the command', async () => {
    const store = fakeControlStore({ recorded, silent: ['unit', 'close'] });
    const opened = await stepTimers(
      fake,
      openControl(definitionOver(store), {}, [registry], schedule),
      store.asked,
      50,
    );
    const reader = await readerOf(opened);
    expect(await stepTimers(fake, reader.reachable(), undefined, 50)).toEqual({
      reachable: false,
      detail: 'no answer within the bound that doctor sets for a read of the control store',
    });
    await stepTimers(fake, opened.close(), undefined, 50);
    expect(store.closed).toEqual([0, 1]);
    expect(store.closing).toEqual([0, 1]);
  });

  test('a connect that never answers has its deadline pending when it is asked, and ends as a store that does not answer, with the adapter closed without waiting', async () => {
    const store = fakeControlStore({ recorded, silent: ['connect', 'close'] });
    const opening = openControl(definitionOver(store), {}, [registry], schedule);
    await store.asked;
    expect(
      fake.timers.some(
        (timer) => !timer.cancelled && timer.milliseconds === doctorReadBounds.deadlineMs,
      ),
    ).toBe(true);
    const reader = await readerOf(await stepTimers(fake, opening, undefined, 50));
    expect(await reader.reachable()).toMatchObject({
      reachable: false,
      detail: expect.stringContaining('no answer within the bound'),
    });
    expect(store.closed).toEqual([0]);
  });
});
