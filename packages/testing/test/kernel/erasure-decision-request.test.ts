import type { DecisionRecord, LedgerRecord, LedgerSink, StoredEvent, Unit } from '@keelwerk/core';
import { consumers, erasure, reactionDispatcher } from '@keelwerk/events';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { dumpDatabase, findPlaintext } from '../../src/index.ts';
import { expectReproduces } from '../../src/replay/expect-reproduces.ts';
import { pgliteQuery } from './support/dump-sections.ts';
import { erasureDumpApp } from './support/erasure-probe-module.ts';

type Runtime = TestRuntime<typeof erasureDumpApp>;

let current: Runtime | undefined;
afterEach(async () => {
  await current?.stop();
  current = undefined;
});

const agentOfS = 'agent-of-the-erased-subject/1.0';
const agentOfT = 'agent-of-the-other-subject/2.0';

const bigintSafe = (_key: string, value: unknown): unknown =>
  typeof value === 'bigint' ? value.toString() : value;

/** What the decision record of an event holds as its request, as stored. */
const requestOf = (event: StoredEvent | undefined): NonNullable<DecisionRecord['request']> => {
  const request = event?.decision?.request;
  if (request === undefined) throw new Error('the decision kept no request');
  return request;
};

describe('the request record of a decision after the erasure of its principal (14.7.5 step 5a, 7.9.6)', () => {
  test.each(['memory', 'pglite'] as const)(
    'on %s: an erased principal leaves no readable request, another principal keeps its own, and every ledger record is written once',
    {
      timeout: 120_000,
    },
    async (kind) => {
      const recorded: LedgerRecord[] = [];
      let dataKeyOfS = '';
      let refused = 0;
      // The sink refuses the first tombstone of a value key, as an unavailable log would.
      const sink: LedgerSink = {
        id: 'flaky',
        append: async (records) => {
          const first = records[0];
          if (refused === 0 && first?.type === 'keyTombstone' && first.keyId !== dataKeyOfS) {
            refused += 1;
            throw new Error('the sink is unavailable');
          }
          recorded.push(...records);
        },
        read: async function* () {
          yield* recorded;
        },
      };
      const worker = erasure({ pollMs: 3_600_000 });
      const runtime = await startTestRuntime(erasureDumpApp, {
        adapter: kind,
        operators: true,
        workers: true,
        ledgers: [sink],
        eventWorkers: [
          consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] }),
          worker,
        ],
      });
      current = runtime;
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
        principal: ReturnType<typeof testPrincipal>,
        agent: string,
        commandId: string,
      ): Promise<unknown> => {
        const base = testCarrier(runtime.tenants.acme, principal);
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
      const eventsOf = (type: string, id: string): Promise<readonly StoredEvent[]> =>
        inTenant((unit) => unit.events.readStream({ type, id }));

      const subjectS = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a01';
      const subjectT = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a02';
      const ids = {
        arriveS: '00000000-0000-7000-8000-00000000f001',
        arriveT: '00000000-0000-7000-8000-00000000f002',
        noteS: '00000000-0000-7000-8000-00000000f003',
        noteT: '00000000-0000-7000-8000-00000000f004',
      };
      const arrivedS = (await call(
        'probe.arrive',
        { ownerId: subjectS },
        testPrincipal(null),
        agentOfS,
        ids.arriveS,
      )) as { sessionId: string };
      const arrivedT = (await call(
        'probe.arrive',
        { ownerId: subjectT },
        testPrincipal(null),
        agentOfT,
        ids.arriveT,
      )) as { sessionId: string };
      const notedS = (await call(
        'probe.note',
        { text: 'a note' },
        testPrincipal(subjectS, { principalId: arrivedS.sessionId }),
        agentOfS,
        ids.noteS,
      )) as { memoId: string };
      await call(
        'probe.note',
        { text: 'a note' },
        testPrincipal(subjectT, { principalId: arrivedT.sessionId }),
        agentOfT,
        ids.noteT,
      );

      // The two forms: a value key of its own under no principal, the subject's data key under a user.
      const arrivalRequest = requestOf((await eventsOf('probe.session', arrivedS.sessionId))[0]);
      const noteRequest = requestOf((await eventsOf('probe.memo', notedS.memoId))[0]);
      if ('$kwe' in arrivalRequest)
        throw new Error('an anonymous decision seals under a value key');
      if (!('$kwe' in noteRequest)) throw new Error('a user decision seals under the data key');
      const keyOfNote = await inTenant((unit) => unit.keys.dataKey(subjectS, { create: false }));
      dataKeyOfS = keyOfNote?.id ?? '';
      expect(noteRequest.k).toBe(dataKeyOfS);
      expect(await inTenant((unit) => unit.keys.openValue(arrivalRequest))).toBeDefined();

      // Before the erasure every decision re-decides.
      for (const [commandId, input] of [
        [ids.arriveS, { ownerId: subjectS }],
        [ids.arriveT, { ownerId: subjectT }],
        [ids.noteS, { text: 'a note' }],
        [ids.noteT, { text: 'a note' }],
      ] as const) {
        expect((await expectReproduces(runtime, { commandId, input })).reproduced).toBe(true);
      }

      const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
      await operator.invoke(
        'core.eraseSubject',
        { subjectId: subjectS as never, reason: 'subjectRequest' },
        { prefer: 'async' },
      );
      await runtime.drainJobs();
      // The first pass fails at the sink, in the unit that destroys the key: nothing is destroyed.
      await worker.pass();
      expect(refused).toBe(1);
      expect(await inTenant((unit) => unit.keys.openValue(arrivalRequest))).toBeDefined();
      // The replay finishes the erasure.
      await worker.pass();

      // (a) neither record opens any more, and no store holds the user agent of the subject.
      expect(await inTenant((unit) => unit.keys.openValue(arrivalRequest))).toBeUndefined();
      expect(await inTenant((unit) => unit.keys.keyById(noteRequest.k))).toBeUndefined();
      const stored = JSON.stringify(
        await inTenant((unit) => unit.events.readAll(null, { limit: 1000 })),
        bigintSafe,
      );
      expect(stored).not.toContain(agentOfS);
      if (kind === 'pglite') {
        const dump = (
          await Promise.all(
            [pgliteQuery(runtime.adapter), pgliteQuery(runtime.control.adapter)].map((query) =>
              dumpDatabase(query),
            ),
          )
        ).join('\n');
        expect(findPlaintext(dump, [agentOfS])).toEqual([]);
        // The control: the other subject's receipt keeps its own user agent, so the dump can show one.
        expect(findPlaintext(dump, [agentOfT])).toEqual([agentOfT]);
      }

      // (b) a re-decide of either decision refuses, naming the erased request.
      for (const [commandId, input] of [
        [ids.arriveS, { ownerId: subjectS }],
        [ids.noteS, { text: 'a note' }],
      ] as const) {
        await expect(expectReproduces(runtime, { commandId, input })).rejects.toMatchObject({
          code: 'core.replay_key_destroyed',
          message: expect.stringContaining('the recorded request'),
        });
      }

      // (c) the decisions of the other subject keep their request readable and re-decide.
      for (const [commandId, input] of [
        [ids.arriveT, { ownerId: subjectT }],
        [ids.noteT, { text: 'a note' }],
      ] as const) {
        expect((await expectReproduces(runtime, { commandId, input })).reproduced).toBe(true);
      }

      // The tombstone of the arrival's request key is in the control ledger once, with the reason erasure.
      const ledger = await runtime.control.adapter.unit(
        runtime.control.namespace,
        { level: 'deployment' },
        (unit) => unit.ledger?.since(0n, 100) ?? Promise.resolve([]),
        { readOnly: true },
      );
      const tombstones = ledger.flatMap((entry) =>
        entry.record.type === 'keyTombstone' && entry.record.keyId === arrivalRequest.keyId
          ? [entry.record]
          : [],
      );
      expect(tombstones).toHaveLength(1);
      expect(tombstones[0]).toMatchObject({ reason: 'erasure' });
      expect(
        recorded.some((r) => r.type === 'keyTombstone' && r.keyId === arrivalRequest.keyId),
      ).toBe(true);
    },
  );
});
