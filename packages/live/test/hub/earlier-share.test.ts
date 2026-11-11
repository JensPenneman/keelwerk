import { describe, expect, test, vi } from 'vitest';
import { fakeListener, fakeScope, fakeView, readerOf } from './support/fake-scope.ts';

describe('the earlier state of a pass', () => {
  test('50 plan groups that ask about the same 5 streams share one image and one budget of 5', async () => {
    const scope = fakeScope();
    const { reader, wake } = readerOf(scope, { pollMs: 10_000, maxEarlierStreams: 5 });
    const same = ['c1', 'c2', 'c3', 'c4', 'c5'];
    const views = Array.from({ length: 50 }, (_, at) => fakeView(`plan-${at}`));
    const listeners = views.map((view) => fakeListener(view, () => same));
    for (const one of listeners) reader.attach(scope.kernel, one.listener);
    await vi.waitFor(() => expect(listeners.every((one) => one.joined.length === 1)).toBe(true));
    scope.commit('c1');
    wake();
    await vi.waitFor(() => expect(listeners.every((one) => one.batches.length === 1)).toBe(true));
    // Every group is asked, none is answered uncertain for lack of budget, and all share one pass-wide image.
    expect(views.every((view) => view.earlier.mock.calls.length === 1)).toBe(true);
    const shares = new Set(views.map((view) => view.earlier.mock.calls[0]?.[1]?.share));
    expect(shares.size).toBe(1);
    expect([...shares][0]).toBeDefined();
    expect(
      listeners.every((one) =>
        [...(one.batches[0]?.earlier.values() ?? [])].every((answer) => !answer.earlier.uncertain),
      ),
    ).toBe(true);
    expect(
      scope.lines.some((line) => line.message.startsWith('a live plan group was not judged')),
    ).toBe(false);
  });
});
