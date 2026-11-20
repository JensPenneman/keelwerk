import type { StoredEvent, Unit } from '@keelwerk/core';
import { consumers, erasure, reactionDispatcher } from '@keelwerk/events';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { dumpDatabase, findPlaintext } from '../../src/index.ts';
import { expectReproduces } from '../../src/replay/expect-reproduces.ts';
import { pgliteQuery } from './support/dump-sections.ts';
import { erasureDumpApp } from './support/erasure-probe-module.ts';

let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

const subjectS = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a01';
const subjectT = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a02';

describe.each(['memory', 'pglite'] as const)(
  'request keys across owned-rows pages on %s (14.7.5 step 5a)',
  (adapter) => {
    /**
     * A runtime with the erasure worker reading one row per page, the subject S with four threads
     * (two found only by the walk of the owned rows, one with a topic that both walks find) and
     * another subject T with one, then six stamps: each by an operator whose principal id is the
     * actor of its command, written on a thread, so each decision record keeps a request under the
     * long-lived key of that principal id.
     */
    async function run(afterStep?: NonNullable<Parameters<typeof erasure>[0]>['afterStep']) {
      const worker = erasure({
        pollMs: 3_600_000,
        pageSize: 1,
        ...(afterStep === undefined ? {} : { afterStep }),
      });
      const runtime = await startTestRuntime(erasureDumpApp, {
        adapter,
        operators: true,
        workers: true,
        eventWorkers: [
          consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] }),
          worker,
        ],
      });
      stop = () => runtime.stop();
      const scope = {
        level: 'tenant',
        backendId: runtime.backendId,
        tenantId: runtime.tenants.acme.id,
      } as const;
      const inTenant = <T>(fn: (unit: Unit) => Promise<T>): Promise<T> =>
        runtime.adapter.unit(runtime.namespace, scope, fn);
      const call = async (
        action: string,
        input: unknown,
        actor: string,
        commandId: string,
        agent: string,
      ): Promise<unknown> => {
        const base = testCarrier(
          runtime.tenants.acme,
          testPrincipal(actor, { claims: { operator: true } }),
        );
        const outcome = await runtime.invoker.invoke({
          action,
          input,
          carrier: { ...base, headers: { ...base.headers, 'user-agent': agent } },
          requestId: crypto.randomUUID(),
          signal: new AbortController().signal,
          commandId,
        });
        if (!outcome.ok) throw outcome.error;
        return outcome.value;
      };
      let seq = 0;
      const open = async (ownerId: string, title: string, topic?: string): Promise<string> => {
        seq += 1;
        const opened = (await call(
          'probe.open',
          { ownerId, title, ...(topic === undefined ? {} : { topic }) },
          'operator',
          `00000000-0000-7000-8000-00000000e${String(seq).padStart(3, '0')}`,
          'setup/1.0',
        )) as { threadId: string };
        return opened.threadId;
      };
      const a = await open(subjectS, 'A');
      const b = await open(subjectS, 'B');
      const c = await open(subjectS, 'D');
      const [first, second, third] = [a, b, c].sort((x, y) => (x < y ? -1 : 1)) as [
        string,
        string,
        string,
      ];
      const topical = await open(subjectS, 'R', 'a personal topic');
      const others = await open(subjectT, 'C');
      const commands = [
        { name: 'c1', actor: second, on: first },
        { name: 'c2', actor: first, on: second },
        { name: 'c3', actor: third, on: topical },
        { name: 'c4', actor: subjectS, on: first },
        { name: 'c5', actor: 'another-operator', on: first },
        { name: 'c6', actor: others, on: others },
      ].map((entry, index) => ({
        ...entry,
        commandId: `00000000-0000-7000-8000-00000000d00${index + 1}`,
        agent: `agent-${entry.name}/1.0`,
      }));
      for (const entry of commands) {
        await call(
          'probe.stampThread',
          { threadId: entry.on },
          entry.actor,
          entry.commandId,
          entry.agent,
        );
      }
      const requestOf = async (entry: (typeof commands)[number]) => {
        const events: readonly StoredEvent[] = await inTenant((unit) =>
          unit.events.readStream({ type: 'probe.thread', id: entry.on }),
        );
        const request = events.find((event) => event.commandId === entry.commandId)?.decision
          ?.request;
        if (request === undefined || '$kwe' in request)
          throw new Error(`${entry.name} kept no key`);
        return request;
      };
      const requests = new Map(
        await Promise.all(
          commands.map(async (entry) => [entry.name, await requestOf(entry)] as const),
        ),
      );
      const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
      const erase = async (): Promise<void> => {
        await operator.invoke(
          'core.eraseSubject',
          { subjectId: subjectS as never, reason: 'subjectRequest' },
          { prefer: 'async' },
        );
        await runtime.drainJobs();
      };
      const tombstonesOf = async (keyId: string) => {
        const ledger = await runtime.control.adapter.unit(
          runtime.control.namespace,
          { level: 'deployment' },
          (unit) => unit.ledger?.since(0n, 1000) ?? Promise.resolve([]),
          { readOnly: true },
        );
        return ledger.filter((e) => e.record.type === 'keyTombstone' && e.record.keyId === keyId);
      };
      const opens = (name: string) =>
        inTenant(async (unit) => {
          const request = requests.get(name);
          return request === undefined ? undefined : unit.keys.openValue(request);
        });
      const receipt = (entry: (typeof commands)[number]) =>
        inTenant((unit) => unit.receipts.get(entry.commandId));
      return { runtime, worker, commands, requests, erase, tombstonesOf, opens, receipt };
    }

    test('the key of a command whose actor is an owned row on another page, on an earlier page, the reference walk, or the subject itself is destroyed once; a foreign actor keeps its own', {
      timeout: 120_000,
    }, async () => {
      const kit = await run();
      for (const entry of kit.commands) {
        expect(await kit.opens(entry.name), entry.name).toBeDefined();
        expect(await kit.receipt(entry), entry.name).toBeDefined();
      }
      await kit.erase();
      await kit.worker.pass();
      for (const entry of kit.commands.slice(0, 4)) {
        expect.soft(await kit.opens(entry.name), `${entry.name} still opens`).toBeUndefined();
        const keyId = kit.requests.get(entry.name)?.keyId ?? '';
        expect.soft(await kit.tombstonesOf(keyId), `${entry.name} tombstones`).toHaveLength(1);
        expect.soft(await kit.receipt(entry), `${entry.name} receipt`).toBeUndefined();
      }
      for (const entry of kit.commands.slice(4)) {
        expect.soft(await kit.opens(entry.name), `${entry.name} was kept`).toBeDefined();
        expect.soft(await kit.receipt(entry), `${entry.name} receipt kept`).toBeDefined();
      }
      // The decision of the other subject's own row still re-decides.
      const own = kit.commands[5];
      if (own === undefined) throw new Error('no c6');
      const input = { threadId: own.on };
      expect(
        (await expectReproduces(kit.runtime, { commandId: own.commandId, input })).reproduced,
      ).toBe(true);
      if (adapter === 'pglite') {
        const dump = (
          await Promise.all(
            [pgliteQuery(kit.runtime.adapter), pgliteQuery(kit.runtime.control.adapter)].map(
              (query) => dumpDatabase(query),
            ),
          )
        ).join('\n');
        const agents = kit.commands.map((entry) => entry.agent);
        // No user agent of a purged command is left in any table; the kept receipts still hold theirs.
        expect(findPlaintext(dump, agents.slice(0, 4))).toEqual([]);
        expect(findPlaintext(dump, agents.slice(4))).toEqual(agents.slice(4));
      }
    });

    test.runIf(adapter === 'memory')(
      'a pass that fails at the first stream is repaired by the next: one tombstone, no key left',
      {
        timeout: 120_000,
      },
      async () => {
        let thrown = false;
        const kit = await run((step) => {
          if (step === 'streams' && !thrown) {
            thrown = true;
            throw new Error('the process stops here');
          }
          return Promise.resolve();
        });
        await kit.erase();
        await kit.worker.pass();
        expect(thrown).toBe(true);
        await kit.worker.pass();
        const second = kit.commands[1];
        if (second === undefined) throw new Error('no c2');
        expect(await kit.opens('c2')).toBeUndefined();
        expect(await kit.tombstonesOf(kit.requests.get('c2')?.keyId ?? '')).toHaveLength(1);
        expect(await kit.receipt(second)).toBeUndefined();
      },
    );
  },
);
