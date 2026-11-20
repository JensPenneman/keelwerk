import type { Unit } from '@keelwerk/core';
import { consumers, erasure, reactionDispatcher } from '@keelwerk/events';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { erasureDumpApp } from './support/erasure-probe-module.ts';
import { serviceHeader, withServiceResolver } from './support/service-resolver.ts';

let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

const subjectS = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a01';
const subjectT = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a02';
const idOf = (n: number) => `00000000-0000-7000-8000-00000000c${String(n).padStart(3, '0')}`;

describe.each(['memory', 'pglite'] as const)(
  'the request record of a principal that is a row the subject owns, on %s (14.7.5 step 5a)',
  (adapter) => {
    test('is unreadable after the erasure wherever the command wrote; one key goes per matched principal id; other principals keep theirs', {
      timeout: 120_000,
    }, async () => {
      // One owned row per page, so the ids are matched on pages other than the command's.
      const worker = erasure({ pollMs: 3_600_000, pageSize: 1 });
      const runtime = await startTestRuntime(withServiceResolver(erasureDumpApp), {
        adapter,
        operators: true,
        workers: true,
        eventWorkers: [
          consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] }),
          worker,
        ],
      });
      stop = () => runtime.stop();
      const { acme } = runtime.tenants;
      const scope = {
        level: 'tenant',
        backendId: runtime.backendId,
        tenantId: acme.id,
      } as const;
      const inTenant = <T>(fn: (unit: Unit) => Promise<T>): Promise<T> =>
        runtime.adapter.unit(runtime.namespace, scope, fn);
      const send = async (
        action: string,
        input: unknown,
        headers: Readonly<Record<string, string>>,
        commandId: string,
      ) => {
        const base = testCarrier(acme, testPrincipal(null));
        const outcome = await runtime.invoker.invoke({
          action,
          input,
          carrier: { ...base, headers: { 'x-tenant': acme.id, ...headers } },
          requestId: crypto.randomUUID(),
          signal: new AbortController().signal,
          commandId,
        });
        if (!outcome.ok) throw outcome.error;
        return outcome.value;
      };
      const open = async (ownerId: string, n: number): Promise<string> => {
        const as = testCarrier(acme, testOperator()).headers ?? {};
        const opened = (await send(
          'probe.open',
          { ownerId, title: `T${n}` },
          { ...as, 'user-agent': 'setup/1.0' },
          idOf(n),
        )) as { threadId: string };
        return opened.threadId;
      };
      const ownedS1 = await open(subjectS, 1);
      const ownedS2 = await open(subjectS, 2);
      await open(subjectS, 3);
      const ownedT = await open(subjectT, 4);

      const asOperator = (principalId: string, agent: string) => ({
        ...(testCarrier(acme, testOperator(principalId)).headers ?? {}),
        'user-agent': agent,
      });
      const asService = (id: string, principalId: string, agent: string) => ({
        [serviceHeader]: JSON.stringify({ id, principalId }),
        'user-agent': agent,
      });
      // Case 1: an operator whose id is a row S owns writes only in T's row, twice (one key).
      // Case 2: a service whose own id differs from the id of its reference, a row S owns.
      // Kept: a service whose reference is T's row, and an operator that owns nothing.
      const commands = [
        { name: 'operatorOfS', destroyed: true, headers: asOperator(ownedS1, 'agent-1/1.0') },
        { name: 'operatorOfSAgain', destroyed: true, headers: asOperator(ownedS1, 'agent-2/1.0') },
        {
          name: 'serviceOfS',
          destroyed: true,
          headers: asService('svc.node', ownedS2, 'agent-3/1.0'),
        },
        {
          name: 'serviceOfT',
          destroyed: false,
          headers: asService('svc.other', ownedT, 'agent-4/1.0'),
        },
        { name: 'foreign', destroyed: false, headers: asOperator('operator-x', 'agent-5/1.0') },
      ].map((entry, index) => ({ ...entry, commandId: idOf(10 + index) }));
      for (const entry of commands) {
        await send('probe.stampThread', { threadId: ownedT }, entry.headers, entry.commandId);
      }
      const requests = await inTenant(async (unit) => {
        const events = await unit.events.readStream({ type: 'probe.thread', id: ownedT });
        return new Map(
          commands.map((entry) => {
            const request = events.find((e) => e.commandId === entry.commandId)?.decision?.request;
            if (request === undefined || '$kwe' in request)
              throw new Error(`${entry.name}: no key`);
            return [entry.name, request] as const;
          }),
        );
      });
      const request = (name: string) => {
        const found = requests.get(name);
        if (found === undefined) throw new Error(name);
        return found;
      };
      // The key is the principal id's, not the service's own id.
      expect(request('operatorOfS').keyId).toBe(`principal:${ownedS1}`);
      expect(request('operatorOfSAgain').keyId).toBe(`principal:${ownedS1}`);
      expect(request('serviceOfS').keyId).toBe(`principal:${ownedS2}`);
      expect(request('serviceOfT').keyId).toBe(`principal:${ownedT}`);
      const opens = (name: string) => inTenant((unit) => unit.keys.openValue(request(name)));
      for (const entry of commands) expect(await opens(entry.name), entry.name).toBeDefined();

      const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
      await operator.invoke(
        'core.eraseSubject',
        { subjectId: subjectS as never, reason: 'subjectRequest' },
        { prefer: 'async' },
      );
      await runtime.drainJobs();
      await worker.pass();

      for (const entry of commands) {
        const opened = await opens(entry.name);
        expect(opened === undefined, `${entry.name} destroyed`).toBe(entry.destroyed);
      }
      // One key per matched principal id that had one, tombstone first, once each: S's third row ran nothing.
      const ledger = await runtime.control.adapter.unit(
        runtime.control.namespace,
        { level: 'deployment' },
        (unit) => unit.ledger?.since(0n, 1000) ?? Promise.resolve([]),
        { readOnly: true },
      );
      const principalTombstones = ledger.flatMap((entry) =>
        entry.record.type === 'keyTombstone' && entry.record.keyId.startsWith('principal:')
          ? [entry.record.keyId]
          : [],
      );
      expect(principalTombstones.sort()).toEqual(
        [`principal:${ownedS1}`, `principal:${ownedS2}`].sort(),
      );
      expect(
        await inTenant((unit) =>
          unit.keys.liveValueKeys([ownedS1, ownedS2, ownedT].map((id) => `principal:${id}`)),
        ),
      ).toEqual([`principal:${ownedT}`]);
      // A principal id is never a subject: no data key, no tombstoned data key, no reference under it.
      await inTenant(async (unit) => {
        for (const id of [ownedS1, ownedS2, ownedT]) {
          expect(await unit.keys.dataKey(id, { create: false })).toBeUndefined();
          expect(await unit.keys.shreddedKeys(id)).toEqual([]);
          expect(await unit.keys.refs(id, null, 10)).toEqual([]);
        }
      });

      // Explain answers as for any destroyed key; the request records of the others stay readable.
      const explain = (commandId: string) =>
        runtime.invoker.invoke<unknown, Record<string, unknown>>({
          action: 'core.explain',
          input: {
            backend: runtime.backendId,
            tenant: acme.id,
            mode: 'redecide',
            commandId,
            input: { threadId: ownedT },
          },
          carrier: {
            transport: 'cli',
            headers: { 'x-tenant': acme.id },
            local: { inProcess: true },
          },
          requestId: crypto.randomUUID(),
          signal: new AbortController().signal,
        });
      for (const entry of commands.filter((c) => c.destroyed)) {
        expect(await explain(entry.commandId), entry.name).toMatchObject({
          ok: false,
          error: {
            code: 'core.replay_key_destroyed',
            message: expect.stringContaining('the recorded request'),
          },
        });
      }
      for (const entry of commands.filter((c) => !c.destroyed)) {
        const answer = await explain(entry.commandId);
        expect(answer.ok, entry.name).toBe(true);
      }
    });
  },
);
