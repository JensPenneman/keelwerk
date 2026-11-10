import { expect, test } from 'vitest';
import type { EventWorker } from '../events/event-worker.ts';
import { runtimeInfrastructure } from './runtime-infrastructure.ts';

function worker(id: string): EventWorker {
  return {
    kind: 'eventWorker',
    provides: [],
    id,
    roles: ['work'],
    runs: ['retention'],
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
  };
}

test('sorts an event worker into eventWorkers', () => {
  const entry = worker('events.retention');
  const sorted = runtimeInfrastructure([entry]);
  expect(sorted.eventWorkers).toHaveLength(1);
  expect(sorted.eventWorkers[0]).toBe(entry);
  expect(sorted.provided.size).toBe(0);
});

test('an entry tagged eventWorker without start and stop is not one', () => {
  const sorted = runtimeInfrastructure([
    { kind: 'eventWorker', id: 'x', roles: [], runs: [], provides: [] },
  ]);
  expect(sorted.eventWorkers).toHaveLength(0);
});

test('an event worker is neither a ledger sink nor a secret provider', () => {
  const sorted = runtimeInfrastructure([worker('events.erasure')]);
  expect(sorted.ledgers).toHaveLength(0);
  expect(sorted.secretProviders).toHaveLength(0);
});

test('keeps the event workers in deployment order', () => {
  const first = worker('events.consumers');
  const second = worker('events.retention');
  const sorted = runtimeInfrastructure([first, second]);
  expect(sorted.eventWorkers).toEqual([first, second]);
  expect(sorted.eventWorkers[0]).toBe(first);
});
