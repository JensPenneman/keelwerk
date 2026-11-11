import { describe, expect, test, vi } from 'vitest';
import {
  fakeListener,
  fakeScope,
  fakeView,
  processStream,
  readerOf,
} from './support/fake-scope.ts';

describe('a scope reader and the state streams of processes', () => {
  test('the events of a process state stream reach no listener, move no head a subscriber can tell and fail nothing', async () => {
    const scope = fakeScope();
    const { reader, wake } = readerOf(scope);
    const watching = fakeListener(fakeView('A'));
    const source = fakeListener();
    reader.attach(scope.kernel, watching.listener);
    reader.attach(scope.kernel, source.listener);
    await vi.waitFor(() => expect(source.joined).toHaveLength(1));
    scope.commit('instance-1', processStream);
    scope.commit('instance-2', processStream);
    wake();
    await vi.waitFor(() => expect(scope.statements.readAll).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(watching.batches).toHaveLength(0);
    expect(source.batches).toHaveLength(0);
    expect(watching.failures).toHaveLength(0);
    expect(source.failures).toHaveLength(0);
    expect(scope.lines).toEqual([]);
    // A card event in the same pass as a process event is delivered alone.
    scope.commit('instance-3', processStream);
    scope.commit('c1');
    wake();
    await vi.waitFor(() => expect(watching.batches).toHaveLength(1));
    expect(watching.batches[0]?.events.map((event) => event.stream.id)).toEqual(['c1']);
    expect(source.batches[0]?.events.map((event) => event.stream.id)).toEqual(['c1']);
  });
});
