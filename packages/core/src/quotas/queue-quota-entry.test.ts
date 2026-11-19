import { expect, test } from 'vitest';
import { queueQuotaEntry } from './queue-quota-entry.ts';

test('the entry of a queue member takes its default from the deployment, else the built-in', () => {
  expect(queueQuotaEntry('commands', 'running', { commands: { running: 8 } })).toEqual({
    ref: 'queue:commands.running',
    module: 'core',
    name: 'queue:commands.running',
    kind: 'count',
    default: 8,
    level: 'tenant',
  });
  expect(queueQuotaEntry('commands', 'queued', { commands: { running: 8 } }).default).toBe(10_000);
  expect(queueQuotaEntry('commands', 'running', undefined).default).toBe(4);
  expect(queueQuotaEntry('commands', 'weight', { commands: { running: 8 } }).default).toBe(1);
});
