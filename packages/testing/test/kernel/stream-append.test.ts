import {
  appendStreamRecords,
  defineApp,
  defineCommand,
  defineModule,
  defineModuleBase,
  defineRule,
  openStoredRecords,
  shape,
} from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { libraryApp } from '../../src/fixtures/index.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { author, bootJournal, readLines } from './support/journal-kit.ts';

const intruderBase = defineModuleBase({ id: 'intruder', version: '0.1.0' });
const intrude = defineCommand(intruderBase, {
  input: shape({}),
  output: shape({}),
  principal: 'user',
  decide: () => ({
    events: [
      Object.freeze({
        kind: 'append',
        type: 'append',
        target: 'core.effectAttempt',
        stream: 'core.effectAttempt',
        key: crypto.randomUUID(),
        records: Object.freeze([{ process: 'p', build: 'b', attempt: 1, startedAt: 'now' }]),
      }),
    ],
    result: {},
  }),
});
const intruderApp = defineApp({
  id: 'intruder',
  modules: [
    defineModule(intruderBase, {
      actions: { intrude },
      policies: {
        intrude: {
          signedIn: defineRule(intruderBase, intrude, { effect: 'allow', principal: 'user' }),
        },
      },
    }),
  ] as const,
});

for (const adapter of ['memory', 'pglite'] as const) {
  describe(`stream appends on ${adapter}`, () => {
    test('a command appends records in its own unit; they read back by key and seq', async () => {
      const journal = await bootJournal({ adapter });
      const written = await journal.call<{ pageId: string }>('journal.writePage', {
        title: 'Day one',
        texts: ['alpha', 'beta'],
      });
      expect(written).toMatchObject({ ok: true });
      const pageId = (written as { value: { pageId: string } }).value.pageId;
      const added = await journal.call('journal.append', { pageId, text: 'gamma' });
      expect(added.ok).toBe(true);
      const records = await readLines(journal.runtime, journal.tenant, pageId, true);
      expect(records.map((record) => [record.seq, (record.data as { text: string }).text])).toEqual(
        [
          [1n, 'alpha'],
          [2n, 'beta'],
          [3n, 'opened'],
          [4n, 'gamma'],
        ],
      );
      await journal.runtime.stop();
    }, 60_000);

    test('an inline reaction appends in the decision unit', async () => {
      const journal = await bootJournal({ adapter });
      const written = await journal.call<{ pageId: string }>('journal.writePage', {
        title: 'Day two',
        texts: [],
      });
      const pageId = (written as { value: { pageId: string } }).value.pageId;
      const records = await readLines(journal.runtime, journal.tenant, pageId, true);
      expect(records.map((record) => record.data)).toEqual([{ text: 'opened', n: 0 }]);
      await journal.runtime.stop();
    }, 60_000);

    test('an invalid record refuses the decision and the records it appended before roll back', async () => {
      const journal = await bootJournal({ adapter });
      const written = await journal.call<{ pageId: string }>('journal.writePage', {
        title: 'Day three',
        texts: ['kept'],
      });
      const pageId = (written as { value: { pageId: string } }).value.pageId;
      const refused = await journal.call('journal.appendTwice', { pageId });
      expect(refused).toMatchObject({ ok: false, error: { kind: 'validation' } });
      const records = await readLines(journal.runtime, journal.tenant, pageId, true);
      expect(records.map((record) => (record.data as { text: string }).text)).toEqual([
        'kept',
        'opened',
      ]);
      await journal.runtime.stop();
    }, 60_000);

    test('a personal member is stored sealed under the keyed row subject and opens again', async () => {
      const journal = await bootJournal({ adapter });
      const written = await journal.call<{ pageId: string }>('journal.writePage', {
        title: 'Day four',
        texts: ['a secret line'],
      });
      const pageId = (written as { value: { pageId: string } }).value.pageId;
      const raw = await readLines(journal.runtime, journal.tenant, pageId, false);
      const first = raw[0]?.data as { text: unknown; n: number };
      expect(first.text).toMatchObject({ $kwe: 1 });
      expect(first.n).toBe(1);
      expect(
        JSON.stringify(raw, (_key, value) => (typeof value === 'bigint' ? String(value) : value)),
      ).not.toContain('a secret line');
      const opened = await readLines(journal.runtime, journal.tenant, pageId, true);
      expect(opened[0]?.data).toEqual({ text: 'a secret line', n: 1 });
      await journal.runtime.stop();
    }, 60_000);

    test('a sealed member moved to another key, stream or member name reads as absent', async () => {
      const journal = await bootJournal({ adapter });
      const written = await journal.call<{ pageId: string }>('journal.writePage', {
        title: 'Day five',
        texts: ['a moved line'],
      });
      const pageId = (written as { value: { pageId: string } }).value.pageId;
      const [stored] = await readLines(journal.runtime, journal.tenant, pageId, false);
      const sealed = ((stored?.data ?? {}) as { text: unknown }).text;
      const elsewhere = crypto.randomUUID();
      const scope = {
        level: 'tenant',
        backendId: journal.runtime.backendId,
        tenantId: journal.tenant.id,
      } as const;
      const moved = await journal.runtime.adapter.unit(
        journal.runtime.namespace,
        scope,
        async (unit) => {
          await unit.streams.append('journal.lines', elsewhere, [{ text: sealed, n: 1 }]);
          await unit.streams.append('journal.other', pageId, [{ text: sealed, n: 1 }]);
          await unit.streams.append('journal.lines', pageId, [{ note: sealed, n: 1 }]);
          return unit.streams.read('journal.lines', pageId, null, 10);
        },
      );
      expect(moved).toHaveLength(3);
      const open = (stream: string, key: string) =>
        journal.runtime.sealed.unit(journal.runtime.namespace, scope, async (unit) =>
          openStoredRecords(unit, {
            stream,
            key,
            personal: ['text', 'note'],
            records: await unit.streams.read(stream, key, null, 10),
          }),
        );
      expect((await open('journal.lines', elsewhere)).map((r) => r.data)).toEqual([{ n: 1 }]);
      expect((await open('journal.other', pageId)).map((r) => r.data)).toEqual([{ n: 1 }]);
      // The same page and stream: the original opens, the one under another member name does not.
      expect((await open('journal.lines', pageId)).map((r) => r.data)).toEqual([
        { text: 'a moved line', n: 1 },
        { text: 'opened', n: 0 },
        { n: 1 },
      ]);
      await journal.runtime.stop();
    }, 60_000);

    test('destroying the subject key leaves the member out; seq, at and order stay', async () => {
      const journal = await bootJournal({ adapter });
      const written = await journal.call<{ pageId: string }>('journal.writePage', {
        title: 'Day six',
        texts: ['first', 'second'],
      });
      const pageId = (written as { value: { pageId: string } }).value.pageId;
      const before = await readLines(journal.runtime, journal.tenant, pageId, true);
      expect(before.map((r) => (r.data as { text: string }).text)).toEqual([
        'first',
        'second',
        'opened',
      ]);
      const scope = {
        level: 'tenant',
        backendId: journal.runtime.backendId,
        tenantId: journal.tenant.id,
      } as const;
      await journal.runtime.adapter.unit(journal.runtime.namespace, scope, (unit) =>
        unit.keys.shred(author),
      );
      const after = await readLines(journal.runtime, journal.tenant, pageId, true);
      expect(after.map((r) => [r.seq, r.at.toString()])).toEqual(
        before.map((r) => [r.seq, r.at.toString()]),
      );
      expect(after.map((r) => r.data)).toEqual([{ n: 1 }, { n: 2 }, { n: 0 }]);
      await journal.runtime.stop();
    }, 60_000);

    test('core.effectAttempt stores the code and status of an error, never its message', async () => {
      const journal = await bootJournal({ adapter });
      const effectId = crypto.randomUUID();
      const scope = {
        level: 'tenant',
        backendId: journal.runtime.backendId,
        tenantId: journal.tenant.id,
      } as const;
      const attempt = (error: object) => ({
        kind: 'append',
        type: 'append',
        target: 'core.effectAttempt',
        stream: 'core.effectAttempt',
        key: effectId,
        records: [
          { process: 'mail', build: 'b1', attempt: 1, startedAt: '2026-11-11T10:00:00Z', error },
        ],
      });
      const projection = {
        kind: 'unavailable',
        code: 'mail.rejected',
        retryable: true,
        requestId: '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a10',
      };
      const message = '550 5.1.1 <bob@example.com>: recipient rejected';
      const append = (error: object) =>
        journal.runtime.sealed.unit(journal.runtime.namespace, scope, (unit) =>
          appendStreamRecords({
            registry: journal.runtime.app.registry,
            unit,
            authority: 'core',
            appends: [attempt(error) as never],
          }),
        );
      await expect(append({ ...projection, message })).rejects.toMatchObject({
        kind: 'validation',
      });
      await append(projection);
      const stored = await journal.runtime.adapter.unit(journal.runtime.namespace, scope, (unit) =>
        unit.streams.read('core.effectAttempt', effectId, null, 10),
      );
      expect(stored.map((r) => (r.data as { error: unknown }).error)).toEqual([projection]);
      expect(
        JSON.stringify(stored, (_k, v) => (typeof v === 'bigint' ? String(v) : v)),
      ).not.toContain('bob@example.com');
      await journal.runtime.stop();
    }, 60_000);

    test("a draft for another module's stream is forbidden", async () => {
      const runtime = await startTestRuntime(intruderApp, { adapter, tenants: ['acme'] });
      const outcome = await runtime.invoker.invoke({
        action: 'intruder.intrude',
        input: {},
        carrier: testCarrier(runtime.tenants.acme, testPrincipal('ada')),
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
      });
      expect(outcome).toMatchObject({
        ok: false,
        error: {
          kind: 'forbidden',
          code: 'core.forbidden',
          details: { stream: 'core.effectAttempt', draft: 'append' },
        },
      });
      await runtime.stop();
    }, 60_000);
  });
}

describe('the library fixture stream', () => {
  test("the library fixture's stream is keyed by library.book and read as it", () => {
    const entry = libraryApp.registry.streams.get('library.annotations');
    expect(entry).toMatchObject({ module: 'library', name: 'annotations', readAs: 'library.book' });
    expect(entry?.key.ref).toEqual({ own: true, entity: 'book' });
    expect(libraryApp.registry.problems).toEqual([]);
  });
});
