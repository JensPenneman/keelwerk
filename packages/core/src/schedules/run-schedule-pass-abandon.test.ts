import { expect, test, vi } from 'vitest';
import { makePassWorld } from '../../test/support/make-pass-world.ts';

vi.mock('../effects/seal-job-input.ts', () => ({
  sealJobInput: async (_unit: unknown, _id: string, _action: unknown, input: unknown) => input,
}));

const T0 = Temporal.Instant.from('2026-01-01T00:05:00Z');

test('a pass whose directory read is cut by the stop rejects and logs no unreadable scope', async () => {
  const w = makePassWorld({ one: ['a1'] });
  w.rows.set(`a1\u0000ticker.everyTenant`, {
    scopeId: 'a1',
    scheduleId: 'ticker.everyTenant',
    nextTick: T0,
  });
  let asked = 0;
  vi.spyOn(w.context.directory, 'tenant').mockImplementation(() => {
    asked += 1;
    return new Promise(() => undefined);
  });
  const pass = w.pass();
  const outcome = expect(pass).rejects.toThrow('stopped');
  await vi.waitFor(() => expect(asked).toBeGreaterThan(0));
  w.state.abandon.abort(new Error('stopped'));
  await outcome;
  expect(w.logs.filter((line) => line.message.includes('could not be read'))).toEqual([]);
});

test('a seeding cut by the stop rejects and logs neither a failed fan-out nor a failed seed', async () => {
  const w = makePassWorld({ one: ['a1'] });
  (w.state as { reseedAt: Temporal.Instant | undefined }).reseedAt = undefined;
  let asked = 0;
  vi.spyOn(w.context.directory, 'backend').mockImplementation(() => {
    asked += 1;
    return new Promise(() => undefined);
  });
  const pass = w.pass();
  const outcome = expect(pass).rejects.toThrow('stopped');
  await vi.waitFor(() => expect(asked).toBeGreaterThan(0));
  w.state.abandon.abort(new Error('stopped'));
  await outcome;
  expect(w.logs.filter((line) => line.level === 'warn')).toEqual([]);
});

test('a seed whose unit is cut by the stop rejects and logs no failed seed', async () => {
  const w = makePassWorld({ one: ['a1'] });
  (w.state as { reseedAt: Temporal.Instant | undefined }).reseedAt = undefined;
  const unit = w.source.handle.adapter.unit.bind(w.source.handle.adapter);
  let asked = 0;
  vi.spyOn(w.source.handle.adapter, 'unit').mockImplementation(async (...args) => {
    asked += 1;
    await new Promise<never>((_, reject) => {
      w.state.abandon.signal.addEventListener('abort', () => reject(w.state.abandon.signal.reason));
    });
    return unit(...args);
  });
  const pass = w.pass();
  const outcome = expect(pass).rejects.toThrow('stopped');
  await vi.waitFor(() => expect(asked).toBeGreaterThan(0));
  w.state.abandon.abort(new Error('stopped'));
  await outcome;
  expect(w.logs.filter((line) => line.level === 'warn')).toEqual([]);
});

test('a deferral cut by the stop rejects with its reason and logs no failed deferral', async () => {
  const w = makePassWorld({ one: ['a1'] });
  w.rows.set(`a1\u0000ticker.unknown`, {
    scopeId: 'a1',
    scheduleId: 'ticker.unknown',
    nextTick: T0,
  });
  const unit = w.source.handle.adapter.unit.bind(w.source.handle.adapter);
  let asked = 0;
  vi.spyOn(w.source.handle.adapter, 'unit').mockImplementation(async (...args) => {
    if (args[1].level !== 'namespace' || args[3]?.readOnly === true) return unit(...args);
    asked += 1;
    await new Promise<never>((_, reject) => {
      w.state.abandon.signal.addEventListener('abort', () => reject(w.state.abandon.signal.reason));
    });
    return unit(...args);
  });
  const pass = w.pass();
  const outcome = expect(pass).rejects.toThrow('stopped');
  await vi.waitFor(() => expect(asked).toBeGreaterThan(0));
  w.state.abandon.abort(new Error('stopped'));
  await outcome;
  expect(w.logs.filter((line) => line.message.includes('could not be deferred'))).toEqual([]);
});
