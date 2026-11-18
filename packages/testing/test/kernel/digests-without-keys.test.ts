import { randomUUID } from 'node:crypto';
import { consumers, erasure, reactionDispatcher } from '@keelwerk/events';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { expectReproduces } from '../../src/replay/expect-reproduces.ts';
import { pgliteQuery } from './support/dump-sections.ts';
import { rowsOf } from './support/erasure-dump-tools.ts';
import { bootErasureRules, stopBooted } from './support/erasure-rules-kit.ts';
import { fingerprintAtRestApp, restScopeOf } from './support/fingerprint-at-rest-app.ts';

type Answer = { ok: boolean; value?: unknown; error?: { code: string } };
type Attempt = (action: string, input: unknown, options: unknown) => Promise<Answer>;

const keyedFingerprint = /^kwf1\.[0-9a-f]{64}$/;

const runtimes: TestRuntime<typeof fingerprintAtRestApp>[] = [];
afterEach(async () => {
  await stopBooted();
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop()));
});

async function bootRest(adapter: 'memory' | 'pglite', withErasure = false) {
  const worker = erasure({ pollMs: 3_600_000 });
  const runtime = await startTestRuntime(fingerprintAtRestApp, {
    adapter,
    operators: true,
    workers: true,
    ...(withErasure
      ? {
          eventWorkers: [
            consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] }),
            worker,
          ],
        }
      : {}),
  });
  runtimes.push(runtime);
  const client = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
  const attempt = (action: string, input: unknown, commandId: string, options: object = {}) =>
    (client as unknown as { attempt: Attempt }).attempt(action, input, { commandId, ...options });
  const read = <T>(
    work: (unit: Parameters<Parameters<typeof runtime.adapter.unit>[2]>[0]) => Promise<T>,
  ) => runtime.adapter.unit(runtime.namespace, restScopeOf(runtime), work, { readOnly: true });
  return { runtime, worker, attempt, read };
}

describe('digesting a command reads and creates no data key (WP-158, J.4)', () => {
  test('a generated set with an update item for a fresh id completes with the item failed and leaves the subject keys as they were', {
    timeout: 120_000,
  }, async () => {
    const booted = await bootErasureRules('pglite');
    const queries = [pgliteQuery(booted.runtime.adapter)];
    const before = (await rowsOf(queries, 'kw_subject_keys')).length;
    const id = randomUUID();
    const answer = await (booted.operator as unknown as { attempt: Attempt }).attempt(
      'probe.person.set',
      { update: [{ id, patch: { notes: 'x' } }] },
      { commandId: randomUUID() },
    );
    expect(answer).toMatchObject({ ok: true, value: { failed: [{ operation: 'update' }] } });
    expect((await rowsOf(queries, 'kw_subject_keys')).length).toBe(before);
  });

  test('a generated set whose refused create item names another input field as the subject of a personal member leaves the subject keys as they were', {
    timeout: 120_000,
  }, async () => {
    const { runtime, attempt } = await bootRest('pglite');
    const queries = [pgliteQuery(runtime.adapter)];
    const before = (await rowsOf(queries, 'kw_subject_keys')).length;
    const replier = randomUUID();
    const answer = await attempt(
      'rest.thread.set',
      {
        // No title: the item is refused as invalid, after both digests are taken.
        create: [{ ownerId: randomUUID(), replierId: replier, reply: 'a reply' }],
      },
      randomUUID(),
    );
    expect(answer).toMatchObject({ ok: true, value: { failed: [{ operation: 'create' }] } });
    const after = await rowsOf(queries, 'kw_subject_keys');
    expect(after.length).toBe(before);
    expect(JSON.stringify(after)).not.toContain(replier);
    // The control of the count: the same item with a title is written, and sealing its reply
    // creates the key of the replier.
    expect(
      await attempt(
        'rest.thread.set',
        { create: [{ title: 'a thread', ownerId: randomUUID(), replierId: replier, reply: 'r' }] },
        randomUUID(),
      ),
    ).toMatchObject({ ok: true, value: { failed: [] } });
    expect(JSON.stringify(await rowsOf(queries, 'kw_subject_keys'))).toContain(replier);
  });

  test('no dataKey or keyById call is made for a refused module command or a generated set with personal members', {
    timeout: 120_000,
  }, async () => {
    const booted = await bootErasureRules('memory');
    const { runtime, operator } = booted;
    const asked: string[] = [];
    const original = runtime.adapter.unit.bind(runtime.adapter);
    runtime.adapter.unit = (namespace, scope, fn, options) =>
      original(
        namespace,
        scope,
        (unit) => {
          for (const method of ['dataKey', 'keyById'] as const) {
            const read = unit.keys[method].bind(unit.keys) as (...args: unknown[]) => unknown;
            (unit.keys as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
              asked.push(method);
              return read(...args);
            };
          }
          return fn(unit);
        },
        options,
      );
    const attempt = (operator as unknown as { attempt: Attempt }).attempt;
    const subject = randomUUID();
    expect(
      await attempt.call(
        operator,
        'probe.claim',
        { ownerId: subject, email: 'a@b.test' },
        {
          commandId: randomUUID(),
        },
      ),
    ).toMatchObject({ ok: false });
    expect(
      await attempt.call(
        operator,
        'probe.person.set',
        {
          update: [{ id: randomUUID(), patch: { notes: 'x' } }],
        },
        { commandId: randomUUID() },
      ),
    ).toMatchObject({ ok: true });
    expect(asked).toEqual([]);
    // The control of the spy: sealing a personal value in a decision does ask for a key.
    await attempt.call(
      operator,
      'probe.enrol',
      { name: 'Bea', email: 'bea.spy@example.test', notes: 'n' },
      { commandId: randomUUID() },
    );
    expect(asked.length).toBeGreaterThan(0);
  });
});

describe.each(['memory', 'pglite'] as const)(
  'a first write and its retry on %s (WP-158, J.4)',
  (kind) => {
    test('a decision that sealed a personal value keeps one receipt fingerprint and one rekeyed event digest, and digesting its source after the commit answers the same texts', {
      timeout: 120_000,
    }, async () => {
      const { runtime, attempt, read } = await bootRest(kind);
      const commandId = randomUUID();
      // The key of the subject of `notes` is created by sealing in the unit of this write.
      const input = { label: 'Ada', notes: 'a private note' };
      expect(await attempt('rest.note', input, commandId)).toMatchObject({ ok: true });
      const stored = () =>
        read(async (unit) => ({
          receipt: await unit.receipts.get(commandId),
          events: (await unit.events.readAll(null, { limit: 100 })).events,
        }));
      const digestOf = (events: Awaited<ReturnType<typeof stored>>['events']) =>
        events.find((event) => event.commandId === commandId)?.decision?.inputDigest;
      const first = await stored();
      expect(first.receipt?.fingerprint).toMatch(keyedFingerprint);
      expect(digestOf(first.events)).toMatch(/^kwd1\.[0-9a-f]{64}$/);
      // The retry computes the same fingerprint again, so it replays and writes nothing.
      expect(await attempt('rest.note', input, commandId)).toMatchObject({ ok: true });
      const second = await stored();
      expect(second.receipt?.fingerprint).toBe(first.receipt?.fingerprint);
      expect(second.events).toHaveLength(first.events.length);
      expect(digestOf(second.events)).toBe(digestOf(first.events));
      // After the commit the same source gives the decision base again: it rekeys, under the data
      // keys of the sealed values, to the digest the event meta holds.
      expect(await expectReproduces(runtime, { commandId, input })).toMatchObject({
        reproduced: true,
      });
    });

    test('share one receipt fingerprint and one event digest for a decision that seals nothing, and the retry replays', {
      timeout: 120_000,
    }, async () => {
      const { attempt, read } = await bootRest(kind);
      const commandId = randomUUID();
      const input = { subjectId: randomUUID(), nickname: 'ada', password: 'hunter2-4711' };
      expect(await attempt('rest.register', input, commandId)).toMatchObject({ ok: true });
      const stored = () =>
        read(async (unit) => ({
          receipt: await unit.receipts.get(commandId),
          events: (await unit.events.readAll(null, { limit: 100 })).events,
        }));
      const first = await stored();
      const digest = first.events.find((event) => event.commandId === commandId)?.decision
        ?.inputDigest;
      expect(first.receipt?.fingerprint).toMatch(keyedFingerprint);
      expect(digest).toMatch(/^kwb1\.[0-9a-f]{64}$/);
      expect(await attempt('rest.register', input, commandId)).toMatchObject({ ok: true });
      const second = await stored();
      expect(second.receipt?.fingerprint).toBe(first.receipt?.fingerprint);
      expect(second.events).toHaveLength(first.events.length);
    });

    test('after the erasure of the subject a personal member names, the event digest still holds no personal value and the failed receipt still does (the known limit)', {
      timeout: 120_000,
    }, async () => {
      const { runtime, worker, attempt, read } = await bootRest(kind, true);
      // The subject: the item whose personal `notes` are sealed under its key.
      const createId = randomUUID();
      const created = await attempt(
        'rest.note',
        { label: 'Ada', notes: 'a private note of ada' },
        createId,
      );
      expect(created).toMatchObject({ ok: true });
      const subject = String((created.value as { itemId: unknown }).itemId);
      const ids = [randomUUID(), randomUUID()];
      const addresses = ['ada@example.test', 'someone.else@example.test'];
      for (const [index, id] of ids.entries()) {
        expect(
          await attempt(
            'rest.register',
            { subjectId: subject, nickname: addresses[index], password: 'p-4711' },
            id,
          ),
        ).toMatchObject({ ok: true });
      }
      const refused = [randomUUID(), randomUUID()];
      for (const [index, id] of refused.entries()) {
        expect(
          await attempt('rest.refuse', { subjectId: subject, nickname: addresses[index] }, id),
        ).toMatchObject({
          ok: false,
          error: { code: 'rest.wrong_password' },
        });
      }
      const snapshot = () =>
        read(async (unit) => ({
          digests: (await unit.events.readAll(null, { limit: 100 })).events
            .filter((event) => ids.some((id) => id === event.commandId))
            .map((event) => event.decision?.inputDigest),
          failed: (await Promise.all(refused.map((id) => unit.receipts.get(id)))).map(
            (receipt) => receipt?.fingerprint,
          ),
        }));
      const before = await snapshot();
      expect(before.digests).toHaveLength(2);
      expect(
        await attempt(
          'core.eraseSubject',
          { subjectId: subject, reason: 'operator' },
          randomUUID(),
          { prefer: 'async' },
        ),
      ).toMatchObject({ ok: true });
      await runtime.drainJobs();
      await worker.pass();
      const stored = await read(async (unit) => ({
        events: (await unit.events.readAll(null, { limit: 100 })).events,
        failed: await Promise.all(refused.map((id) => unit.receipts.get(id))),
        created: await unit.receipts.get(createId),
      }));
      // The erasure ran: the receipt of the write into the subject's stream is scrubbed.
      expect(stored.created?.fingerprint).toBe('erased');
      const digests = ids.map(
        (id) => stored.events.find((event) => event.commandId === id)?.decision?.inputDigest,
      );
      // The meta holds the decision base, so another address still gives the same digest.
      expect(digests[0]).toMatch(/^kwb1\./);
      expect(digests[1]).toBe(digests[0]);
      // The failed receipt is the keyed fingerprint: it covers the address and keeps it after an
      // erasure (erasure inventory, core__command_receipt: a failed receipt keeps its keyed digest
      // of personal members).
      const [one, two] = stored.failed;
      expect(one?.fingerprint).toMatch(keyedFingerprint);
      expect(two?.fingerprint).toMatch(keyedFingerprint);
      expect(two?.fingerprint).not.toBe(one?.fingerprint);
      // The erasure of the subject the addresses belong to changed none of them: the digests are
      // keyed under the scope key, never under the data key of the subject that was shredded.
      expect(await snapshot()).toEqual(before);
    });
  },
);
