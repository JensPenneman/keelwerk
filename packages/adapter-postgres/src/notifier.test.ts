import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createNotifier } from './notifier.ts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('reports of one window leave as one payload per namespace', async () => {
  const sent: string[] = [];
  const notifier = createNotifier({
    send: async (payload) => {
      sent.push(payload);
    },
    onError: () => undefined,
  });
  notifier.committed('ns-1', 'a');
  notifier.committed('ns-1', 'b');
  notifier.committed('ns-1', 'a');
  notifier.committed('ns-2', 'c');
  expect(sent).toEqual([]);
  await vi.advanceTimersByTimeAsync(50);
  expect(sent).toEqual(['ns-1:a,b', 'ns-2:c']);
  notifier.committed('ns-1', 'd');
  await vi.advanceTimersByTimeAsync(50);
  expect(sent).toEqual(['ns-1:a,b', 'ns-2:c', 'ns-1:d']);
  await notifier.stop();
});

test('a list past the payload limit becomes namespace-wide, and stop sends what is pending', async () => {
  const sent: string[] = [];
  const notifier = createNotifier({
    send: async (payload) => {
      sent.push(payload);
    },
    onError: () => undefined,
    maxPayloadBytes: 20,
  });
  notifier.committed('ns-1', 'a'.repeat(30));
  await notifier.stop();
  expect(sent).toEqual(['ns-1:*']);
  notifier.committed('ns-1', 'late');
  await notifier.stop();
  expect(sent).toEqual(['ns-1:*']);
});

test('a failed send is reported and does not stop the next namespace', async () => {
  const sent: string[] = [];
  const errors: unknown[] = [];
  const notifier = createNotifier({
    send: async (payload) => {
      if (payload.startsWith('ns-1')) throw new Error('down');
      sent.push(payload);
    },
    onError: (error) => errors.push(error),
  });
  notifier.committed('ns-1', 'a');
  notifier.committed('ns-2', 'b');
  await vi.advanceTimersByTimeAsync(50);
  expect(sent).toEqual(['ns-2:b']);
  expect(errors).toHaveLength(1);
  await notifier.stop();
});
