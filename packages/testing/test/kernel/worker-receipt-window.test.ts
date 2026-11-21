import { afterAll, expect, test } from 'vitest';
import { testOperator } from '../../src/harness/test-operator.ts';
import {
  acmeScope,
  askCloseAll,
  lendBook,
  startWatched,
  workerStart,
} from './support/worker-kit.ts';

const commandId = '00000000-0000-7000-8000-000000000031';

const { runtime, spy } = await startWatched({ workers: true });
afterAll(() => runtime.stop());

test('a job that runs after its receipt window takes over its accepted receipt and appends the completed record', async () => {
  await lendBook(runtime, 'Dune');
  const accepted = await askCloseAll(runtime, commandId, testOperator('olive'));
  expect(accepted.ok).toBe(true);
  const before = await runtime.adapter.unit(runtime.namespace, acmeScope(runtime), (unit) =>
    unit.receipts.get(commandId),
  );
  expect(before?.status).toBe('accepted');
  // The window of a receipt is a day: the job runs a day and an hour after the acceptance.
  expect(before?.expiresAt.epochMilliseconds).toBeLessThan(
    workerStart.add({ hours: 25 }).epochMilliseconds,
  );
  expect(await runtime.advanceTo(workerStart.add({ hours: 25 }))).toBe(1);
  const after = await runtime.adapter.unit(runtime.namespace, acmeScope(runtime), (unit) =>
    unit.receipts.get(commandId),
  );
  expect(after?.status).toBe('completed');
  expect(after?.fingerprint).toBe(before?.fingerprint);
  expect(spy.completions.at(-1)?.outcome).toEqual({ kind: 'succeeded' });
  const page = await runtime.adapter.unit(runtime.namespace, acmeScope(runtime), (unit) =>
    unit.events.readAll(null, { limit: 100, includeTransient: true }),
  );
  expect(
    page.events
      .filter((event) => event.stream.type === 'core.commandReceipt')
      .map((event) => event.type),
  ).toEqual(['core.commandReceipt.created', 'core.commandReceipt.changed']);
});
