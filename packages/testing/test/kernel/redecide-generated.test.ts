import { afterEach, describe, expect, test } from 'vitest';
import { conformanceApp, libraryApp } from '../../src/fixtures/index.ts';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { expectReproduces } from '../../src/replay/expect-reproduces.ts';
import { startHookEndpoint } from './support/hook-endpoint.ts';
import { bootHooks } from './support/hooks-kit.ts';
import { drainHooks } from './support/hooks-reads.ts';

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

describe.each(['memory', 'pglite'] as const)(
  're-deciding generated commands on %s (S-77)',
  (kind) => {
    async function libraryOn() {
      const runtime = await startTestRuntime(libraryApp, { adapter: kind, tenants: ['acme'] });
      cleanup.push(() => runtime.stop());
      const client = {
        invoke: async (action: string, input: unknown, options: { commandId: string }) => {
          const outcome = await runtime.invoker.invoke({
            action,
            input,
            carrier: testCarrier(runtime.tenants.acme, testPrincipal('ada')),
            requestId: crypto.randomUUID(),
            signal: new AbortController().signal,
            commandId: options.commandId,
          });
          if (!outcome.ok) throw outcome.error;
          return outcome.value;
        },
      };
      return { runtime, client };
    }

    test('generated create, update, archive and restore of library.book re-decide', {
      timeout: 90_000,
    }, async () => {
      const { runtime, client } = await libraryOn();
      const created = { title: 'Dune', isbn: '1', addedBy: 'ada' };
      const book = (await client.invoke('library.book.create', created, {
        commandId: '00000000-0000-7000-8000-0000000000c1',
      })) as { id: string };
      const steps = [
        ['library.book.update', { id: book.id, patch: { title: 'Dune Messiah' }, ifVersion: 1 }],
        ['library.book.archive', { id: book.id }],
        ['library.book.restore', { id: book.id }],
      ] as const;
      await expectReproduces(runtime, {
        commandId: '00000000-0000-7000-8000-0000000000c1',
        input: created,
      });
      let n = 1;
      for (const [action, input] of steps) {
        n += 1;
        const commandId = `00000000-0000-7000-8000-0000000000c${n}`;
        await client.invoke(action, input, { commandId });
        const result = await expectReproduces(runtime, { commandId, input });
        expect(result.part).toBe(action);
      }
    });

    test('a generated set re-decides its items', { timeout: 90_000 }, async () => {
      const { runtime, client } = await libraryOn();
      const first = (await client.invoke(
        'library.book.create',
        { title: 'A', isbn: 'a', addedBy: 'ada' },
        { commandId: '00000000-0000-7000-8000-0000000000d0' },
      )) as { id: string };
      const input = {
        create: [{ title: 'C', isbn: 'c', addedBy: 'ada' }],
        update: [{ id: first.id, patch: { title: 'A2' }, ifVersion: 1 }],
      };
      const commandId = '00000000-0000-7000-8000-0000000000d1';
      await client.invoke('library.book.set', input, { commandId });
      const result = await expectReproduces(runtime, { commandId, input });
      expect(result.part).toBe('library.book.set');
      expect(result.recorded.events).toHaveLength(2);
    });

    test('hooks.notify re-decides: its requested effect is compared by id, not as an event', {
      timeout: 90_000,
    }, async () => {
      const endpoint = await startHookEndpoint();
      const booted = await bootHooks({ adapter: kind, endpoint: endpoint.url });
      cleanup.push(
        () => booted.runtime.stop(),
        () => endpoint.close(),
      );
      const input = { payload: '{"hello":"world"}' };
      const commandId = '00000000-0000-7000-8000-0000000000e1';
      await booted.client.invoke('hooks.notify', input, { commandId });
      await drainHooks(booted);
      const result = await expectReproduces(booted.runtime, { commandId, input });
      expect(result.recorded.decision?.effects).toHaveLength(1);
      expect(result.redecided.decision?.effects).toEqual(result.recorded.decision?.effects);
      expect(result.recorded.events.map((event) => event.stream.split('/')[0])).toEqual([
        'hooks.delivery',
      ]);
    });

    test('hooks.notify no longer re-decides when its requested effect record is another effect: the type, the input or the key differs', {
      timeout: 90_000,
    }, async () => {
      const endpoint = await startHookEndpoint();
      const booted = await bootHooks({ adapter: kind, endpoint: endpoint.url, serveOnly: true });
      cleanup.push(
        () => booted.runtime.stop(),
        () => endpoint.close(),
      );
      const input = { payload: '{"hello":"world"}' };
      const commandId = '00000000-0000-7000-8000-0000000000e2';
      await booted.client.invoke('hooks.notify', input, { commandId });
      await expectReproduces(booted.runtime, { commandId, input });
      const descriptor = booted.runtime.app.registry.entities.get('core.effect')?.descriptor;
      if (descriptor === undefined) throw new Error('no core.effect');
      const tamper = (values: Record<string, unknown>) =>
        booted.raw(async (unit) => {
          const [row] = (await unit.rows.find(descriptor, {})).rows;
          if (row === undefined) throw new Error('the command left no effect record');
          await unit.rows.update(descriptor, [
            {
              id: String(row.id),
              expectedVersion: Number(row.version),
              values: { ...row, ...values, version: Number(row.version) + 1 },
            },
          ]);
          return row;
        });
      // The failed assertion of `expectReproduces` carries the differences as its `actual`.
      const differences = async (): Promise<readonly string[]> =>
        expectReproduces(booted.runtime, { commandId, input }).then(
          () => [],
          (error: unknown) => (error as { actual: readonly string[] }).actual,
        );
      const before = await tamper({ key: 'another-key' });
      expect(await differences()).toEqual([
        expect.stringMatching(/the key of the effect .* differs/),
      ]);
      await tamper({ key: before.key ?? null, type: 'hooks.other' });
      expect(await differences()).toEqual([
        expect.stringContaining('was requested as hooks.other and is now hooks.post'),
      ]);
      await tamper({
        type: before.type,
        input: { ...(before.input as Record<string, unknown>), added: 'member' },
      });
      expect(await differences()).toEqual([
        expect.stringMatching(/the input of the effect .* differs in "added"/),
      ]);
    });
  },
);

describe('re-deciding an asynchronous command', () => {
  test('an asynchronous command re-decides: its receipt change records are not part of the decision', {
    timeout: 90_000,
  }, async () => {
    const runtime = await startTestRuntime(conformanceApp, { operators: true, workers: true });
    cleanup.push(() => runtime.stop());
    const bea = createLocalClient(runtime, { principal: testPrincipal('bea') });
    const { acme } = runtime.tenants;
    await bea.invoke('loans.lend', {
      bookTitle: 'Dune',
      dueAt: Temporal.Instant.from('2027-01-01T00:00:00Z'),
    });
    const commandId = '00000000-0000-7000-8000-0000000000f1';
    const input = { borrower: 'bea' };
    const accepted = await runtime.invoker.invoke({
      action: 'loans.closeAll',
      input,
      carrier: testCarrier(acme, testOperator('olive')),
      requestId: crypto.randomUUID(),
      commandId,
      prefer: 'async',
      signal: new AbortController().signal,
    });
    expect(accepted).toMatchObject({ ok: true, receipt: { status: 'accepted' } });
    await runtime.drainJobs();
    const result = await expectReproduces(runtime, { commandId, input });
    expect(result.part).toBe('loans.closeAll');
    expect(result.recorded.events.length).toBeGreaterThan(0);
  });
});
