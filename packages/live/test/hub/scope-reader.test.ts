import type { LiveKernel } from '@keelwerk/core';
import { describe, expect, test, vi } from 'vitest';
import type { Line } from './support/fake-scope.ts';
import { fakeListener, fakeScope, fakeView, readerOf } from './support/fake-scope.ts';

describe('a scope reader', () => {
  test('50 subscribers in two plan groups: inPlan and present run twice per batch', async () => {
    const scope = fakeScope();
    const { reader, wake } = readerOf(scope);
    const views = [fakeView('A'), fakeView('B')];
    const listeners = Array.from({ length: 50 }, (_, at) => {
      const own = at % 2 === 0 ? fakeView('A') : fakeView('B');
      views.push(own);
      return fakeListener(own);
    });
    for (const one of listeners) reader.attach(scope.kernel, one.listener);
    await vi.waitFor(() => expect(listeners.every((one) => one.joined.length === 1)).toBe(true));
    for (const view of views) {
      view.inPlan.mockClear();
      view.present.mockClear();
    }
    scope.commit('c1');
    wake();
    await vi.waitFor(() => expect(listeners.every((one) => one.batches.length === 1)).toBe(true));
    const calls = (name: 'inPlan' | 'present') =>
      views.reduce((total, view) => total + view[name].mock.calls.length, 0);
    expect(calls('inPlan')).toBe(2);
    expect(calls('present')).toBe(2);
    const [first] = listeners;
    expect(first?.batches[0]?.verdicts.size).toBe(2);
  });

  test('a pass past its deadline delivers nothing, logs its late rejection once, the next pass re-reads', async () => {
    let stall: (() => void) | undefined;
    let stalls = 0;
    const scope = fakeScope({
      readStalls: () => {
        stalls += 1;
        if (stalls !== 2) return undefined;
        return new Promise<void>((_resolve, reject) => {
          stall = () => reject(new Error('the unit ended'));
        });
      },
    });
    const { reader, wake } = readerOf(scope, { passTimeoutMs: 50, pollMs: 40 });
    const one = fakeListener(fakeView('A'));
    reader.attach(scope.kernel, one.listener);
    await vi.waitFor(() => expect(one.joined).toHaveLength(1));
    scope.commit('c1');
    wake();
    await vi.waitFor(() =>
      expect(scope.lines.some((line) => line.message === 'a live reader pass was abandoned')).toBe(
        true,
      ),
    );
    // The abandoned pass delivers nothing; the pass that follows reads the event again and delivers it.
    await vi.waitFor(() => expect(one.batches).toHaveLength(1));
    expect(one.batches[0]?.events.map((event) => event.stream.id)).toEqual(['c1']);
    const late = (): Line[] =>
      scope.lines.filter(
        (line) => line.message === 'a live reader pass failed after it was abandoned',
      );
    expect(late()).toHaveLength(0);
    stall?.();
    await vi.waitFor(() => expect(late()).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(late()).toHaveLength(1);
    expect(one.batches).toHaveLength(1);
    for (const line of scope.lines) {
      expect(JSON.stringify(line.fields ?? {})).not.toMatch(/c1/);
    }
  });

  test('three failed passes end every subscriber unavailable', async () => {
    const scope = fakeScope();
    scope.kernel = {
      ...scope.kernel,
      read: () => Promise.reject(new Error('the database is gone')),
    } as LiveKernel;
    const { reader, stopped } = readerOf(scope, { pollMs: 10 });
    const first = fakeListener(fakeView('A'));
    const second = fakeListener(fakeView('B'));
    reader.attach(scope.kernel, first.listener);
    reader.attach(scope.kernel, second.listener);
    await vi.waitFor(() => expect(first.failures).toHaveLength(1));
    expect(second.failures).toHaveLength(1);
    expect(first.failures[0]).toMatchObject({ kind: 'unavailable', code: 'core.unavailable' });
    expect(reader.size).toBe(0);
    expect(stopped).toHaveBeenCalledOnce();
  });

  test('a joining subscriber gets join(at) of the first pass that carries it and no batch before', async () => {
    const scope = fakeScope();
    const { reader, wake } = readerOf(scope);
    const early = fakeListener(fakeView('A'));
    reader.attach(scope.kernel, early.listener);
    await vi.waitFor(() => expect(early.joined).toHaveLength(1));
    scope.commit('c1');
    scope.commit('c2');
    const late = fakeListener(fakeView('A'));
    reader.attach(scope.kernel, late.listener);
    await vi.waitFor(() => expect(late.joined).toEqual([2n]));
    await vi.waitFor(() => expect(early.batches.length).toBeGreaterThanOrEqual(0));
    // Nothing the late subscriber joined past is delivered to it.
    expect(late.batches.filter((batch) => batch.to <= 2n)).toHaveLength(0);
    scope.commit('c3');
    wake();
    await vi.waitFor(() => expect(late.batches.at(-1)?.to).toBe(3n));
    expect(late.batches.every((batch) => batch.to > 2n)).toBe(true);
    expect(early.batches.at(-1)?.to).toBe(3n);
  });

  test('the last detach stops the loop and the timer', async () => {
    const scope = fakeScope();
    const { reader, stopped, unwatched } = readerOf(scope, { pollMs: 10 });
    const one = fakeListener(fakeView('A'));
    const detach = reader.attach(scope.kernel, one.listener);
    await vi.waitFor(() => expect(one.joined).toHaveLength(1));
    detach();
    detach();
    expect(stopped).toHaveBeenCalledOnce();
    expect(unwatched).toHaveBeenCalledOnce();
    const reads = scope.state.reads;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(scope.state.reads).toBe(reads);
  });

  test('200 partial listeners cost the same number of statements in a pass as one', async () => {
    const statementsOf = async (count: number): Promise<number> => {
      const scope = fakeScope();
      const { reader, wake } = readerOf(scope, { pollMs: 10_000 });
      // Every listener holds a partial set and cannot decide the changed stream: it asks for it.
      const listeners = Array.from({ length: count }, () =>
        fakeListener(
          fakeView('A', async (unit, ids) => {
            for (const id of ids) {
              await unit.rows.find(
                {} as never,
                { where: { op: 'eq', field: 'id', value: id } } as never,
              );
            }
            return { rows: new Map(), uncertain: false };
          }),
          () => ['c1'],
        ),
      );
      for (const one of listeners) reader.attach(scope.kernel, one.listener);
      await vi.waitFor(() => expect(listeners.every((one) => one.joined.length === 1)).toBe(true));
      scope.commit('c1');
      const before = { ...scope.statements };
      wake();
      await vi.waitFor(() => expect(listeners.every((one) => one.batches.length === 1)).toBe(true));
      return (
        scope.statements.head -
        before.head +
        (scope.statements.readAll - before.readAll) +
        (scope.statements.find - before.find)
      );
    };
    const one = await statementsOf(1);
    expect(one).toBeGreaterThan(0);
    expect(await statementsOf(200)).toBe(one);
  });

  test('the views of one plan group are asked once, for the union of the streams their listeners cannot decide', async () => {
    const scope = fakeScope();
    const { reader, wake } = readerOf(scope, { pollMs: 10_000 });
    const asked: (readonly string[])[] = [];
    const view = (key: string) =>
      fakeView(key, async (_unit, ids) => {
        asked.push(ids);
        return { rows: new Map(), uncertain: false };
      });
    const a = fakeListener(view('A'), () => ['c1']);
    const b = fakeListener(view('A'), () => ['c1', 'c2']);
    const other = fakeListener(view('B'), () => []);
    for (const one of [a, b, other]) reader.attach(scope.kernel, one.listener);
    await vi.waitFor(() =>
      expect([a, b, other].every((one) => one.joined.length === 1)).toBe(true),
    );
    scope.commit('c1');
    scope.commit('c2');
    wake();
    await vi.waitFor(() => expect(a.batches).toHaveLength(1));
    expect(asked).toEqual([['c1', 'c2']]);
    const [batch] = a.batches;
    expect([...(batch?.earlier.keys() ?? [])]).toEqual(['t.card A']);
    expect(batch?.earlier.get('t.card A')?.asked).toEqual(new Set(['c1', 'c2']));
  });

  test('a group past the stream budget of the pass is answered uncertain and never asked', async () => {
    const scope = fakeScope();
    const { reader, wake } = readerOf(scope, { pollMs: 10_000, maxEarlierStreams: 2 });
    const view = fakeView('A');
    const one = fakeListener(view, () => ['c1', 'c2', 'c3']);
    reader.attach(scope.kernel, one.listener);
    await vi.waitFor(() => expect(one.joined).toHaveLength(1));
    scope.commit('c1');
    wake();
    await vi.waitFor(() => expect(one.batches).toHaveLength(1));
    expect(view.earlier).not.toHaveBeenCalled();
    expect(one.batches[0]?.earlier.get('t.card A')?.earlier.uncertain).toBe(true);
    expect(
      scope.lines.some((line) => line.message.startsWith('a live plan group was not judged')),
    ).toBe(true);
  });

  test('an earlier state that hangs hits the deadline of the pass: nothing is delivered, the next pass asks again', async () => {
    const scope = fakeScope();
    const { reader, wake } = readerOf(scope, { passTimeoutMs: 50, pollMs: 10_000 });
    let asks = 0;
    const one = fakeListener(
      fakeView('A', async () => {
        asks += 1;
        // The first ask never answers; the second does.
        if (asks === 1) await new Promise(() => undefined);
        return { rows: new Map(), uncertain: false };
      }),
      () => ['c1'],
    );
    reader.attach(scope.kernel, one.listener);
    await vi.waitFor(() => expect(one.joined).toHaveLength(1));
    scope.commit('c1');
    wake();
    await vi.waitFor(() =>
      expect(scope.lines.some((line) => line.message === 'a live reader pass was abandoned')).toBe(
        true,
      ),
    );
    expect(one.batches).toHaveLength(0);
    // The pass that follows reads the event again and asks again.
    wake();
    await vi.waitFor(() => expect(one.batches).toHaveLength(1));
    expect(asks).toBe(2);
    expect(one.failures).toHaveLength(0);
  });

  test('a new distinct plan past the plan-group bound is refused with the neutral message, a known plan is not', () => {
    const scope = fakeScope();
    const { reader } = readerOf(scope, { maxPlanGroupsPerScope: 2 });
    reader.attach(scope.kernel, fakeListener(fakeView('A')).listener);
    reader.attach(scope.kernel, fakeListener(fakeView('B')).listener);
    reader.attach(scope.kernel, fakeListener(fakeView('A')).listener);
    expect(() => reader.attach(scope.kernel, fakeListener(fakeView('C')).listener)).toThrow(
      expect.objectContaining({
        kind: 'unavailable',
        message: 'Live updates are not available now.',
      }),
    );
    const refused = scope.lines.find((line) => line.message === 'a live subscription was refused');
    expect(refused?.fields).toEqual({
      scope: 'scope-1',
      bound: 'plan groups of the scope',
      count: 2,
      limit: 2,
    });
  });

  test('the subscriber bound of a scope tells the same neutral message and logs the bound', () => {
    const scope = fakeScope();
    const { reader } = readerOf(scope, { maxSubscribersPerScope: 1 });
    reader.attach(scope.kernel, fakeListener(fakeView('A')).listener);
    expect(() => reader.attach(scope.kernel, fakeListener(fakeView('A')).listener)).toThrow(
      expect.objectContaining({
        kind: 'unavailable',
        message: 'Live updates are not available now.',
      }),
    );
    expect(
      scope.lines.find((line) => line.message === 'a live subscription was refused')?.fields,
    ).toMatchObject({ bound: 'subscribers of the scope', count: 1, limit: 1 });
  });

  test('close stops every reader, wake loop and timer and waits for the pass in flight', async () => {
    vi.useFakeTimers();
    try {
      let release: (() => void) | undefined;
      const scope = fakeScope({
        readStalls: () => new Promise<void>((resolve) => (release = resolve)),
      });
      const { reader, stopped, unwatched } = readerOf(scope, {
        passTimeoutMs: 60_000,
        pollMs: 1000,
      });
      const one = fakeListener(fakeView('A'));
      reader.attach(scope.kernel, one.listener);
      // The first pass is blocked in its unit.
      await vi.advanceTimersByTimeAsync(10);
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      reader.close();
      expect(one.ends).toHaveLength(1);
      expect(one.failures).toHaveLength(0);
      expect(stopped).toHaveBeenCalledOnce();
      expect(unwatched).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      let settled = false;
      void reader.settled().then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(5000);
      expect(settled).toBe(false);
      release?.();
      await vi.advanceTimersByTimeAsync(10);
      expect(settled).toBe(true);
      expect(one.joined).toEqual([]);
      expect(one.batches).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
