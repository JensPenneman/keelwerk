import type { StorageRow } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';

import { casingApp } from './support/erasure-stored-case-app.ts';

let current: TestRuntime<typeof casingApp> | undefined;
afterEach(async () => {
  await current?.stop();
  current = undefined;
});

const subject = '0f1f2f3f-4f5f-6f7f-8f9f-afbfcfdfefff';
const stored = subject.toUpperCase();

const scopeOf = (runtime: TestRuntime<typeof casingApp>) =>
  ({
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme?.id ?? '',
  }) as const;

async function boot() {
  const runtime = await startTestRuntime(casingApp, { adapter: 'memory', operators: true });
  current = runtime;
  const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
  return { runtime, operator };
}

/** A row and its created event written as an earlier release did, with the subject in upper case. */
async function storeEntry(runtime: TestRuntime<typeof casingApp>): Promise<string> {
  const descriptor = runtime.app.registry.entities.get('casing.entry')?.descriptor;
  if (descriptor === undefined) throw new Error('no casing.entry');
  const at = Temporal.Now.instant();
  const id = crypto.randomUUID();
  const values = { id, title: 'stored', ownerId: stored };
  await runtime.adapter.unit(runtime.namespace, scopeOf(runtime), async (unit) => {
    await unit.rows.insert(descriptor, [{ ...values, createdAt: at, updatedAt: at, version: 1 }]);
    await unit.events.append([
      {
        stream: { type: 'casing.entry', id },
        expectedVersion: 0,
        partition: null,
        events: [
          {
            eventId: crypto.randomUUID(),
            name: 'created',
            schemaVersion: 1,
            shape: descriptor.shape.id,
            data: values,
            before: null,
            hlc: '0' as never,
            recordedAt: at,
            meta: {
              actor: { kind: 'operator', id: null, via: 'test' },
              commandId: crypto.randomUUID(),
              action: 'casing.enter',
              causationId: null,
              correlationId: crypto.randomUUID(),
              client: null,
              merge: null,
              traceparent: null,
              writer: { build: 'test', revision: 0 },
              flags: [],
              decision: null,
            },
            transient: false,
            prevHash: null,
            hash: null,
          },
        ],
      },
    ]);
  });
  return id;
}

describe('a subject stored in upper case is never a reason to fail a read (14.7.4)', () => {
  test('the row is loaded, listed and read through the generated actions', {
    timeout: 60_000,
  }, async () => {
    const { runtime, operator } = await boot();
    const id = await storeEntry(runtime);
    expect(await operator.invoke('casing.ownerOf', { entryId: id as never })).toEqual({
      ownerId: stored,
    });
    expect(await operator.invoke('casing.owners', {})).toEqual({ owners: [stored] });
    const page = await operator.invoke('casing.entry.query', {});
    expect((page as { items: readonly StorageRow[] }).items.map((row) => row.ownerId)).toEqual([
      stored,
    ]);
    const got = await operator.invoke('casing.entry.get', { ids: [id as never] });
    expect(JSON.stringify(got)).toContain(stored);
  });

  test('the row is streamed through a custom subscription and the generated watch', {
    timeout: 60_000,
  }, async () => {
    const { runtime } = await boot();
    const id = await storeEntry(runtime);
    const tenant = runtime.tenants.acme;
    if (tenant === undefined) throw new Error('no acme');
    for (const action of ['casing.ownerEvents', 'casing.entry.watch']) {
      const abort = new AbortController();
      const iterator = runtime.invoker
        .subscribe<unknown, Record<string, unknown>>({
          action,
          input: action === 'casing.entry.watch' ? { from: 'beginning' } : {},
          carrier: testCarrier(tenant, testPrincipal('watcher')),
          requestId: crypto.randomUUID(),
          signal: abort.signal,
        })
        [Symbol.asyncIterator]();
      const seen: string[] = [];
      const until = Date.now() + 15_000;
      while (!seen.join('').includes(id) && Date.now() < until) {
        const step = await iterator.next();
        if (step.done === true) break;
        seen.push(JSON.stringify(step.value, (_k, v) => (typeof v === 'bigint' ? `${v}` : v)));
      }
      abort.abort();
      await iterator.return?.();
      expect(seen.join('')).toContain(id);
      expect(seen.join('')).toContain(stored);
    }
  });
});

describe('a child under a parent whose stored path subject is in upper case (14.7.4)', () => {
  test('the child is written and sealed under the one key of that subject', {
    timeout: 60_000,
  }, async () => {
    const { runtime, operator } = await boot();
    const id = await storeEntry(runtime);
    const made = (await operator.invoke('casing.addNote', {
      entryId: id as never,
      body: 'a note',
    })) as { noteId: string };
    expect(made.noteId).toBeDefined();
    const keys = await runtime.adapter.unit(
      runtime.namespace,
      scopeOf(runtime),
      async (unit) => ({
        folded: await unit.keys.dataKey(subject, { create: false }),
        stored: await unit.keys.dataKey(stored, { create: false }),
        refs: await unit.keys.refs(subject, null, 100),
      }),
      { readOnly: true },
    );
    expect(keys.folded?.id).toBeDefined();
    expect(keys.stored?.id).toBe(keys.folded?.id);
    expect(keys.refs.map((ref) => ref.id)).toContain(made.noteId);
  });
});

describe('an input or a draft that writes an upper-case subject is refused (14.7.4)', () => {
  test('an input is a validation error', { timeout: 60_000 }, async () => {
    const { operator } = await boot();
    const outcome = await operator.attempt('casing.enter', {
      ownerId: stored as never,
      title: 't',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatchObject({ kind: 'validation' });
  });

  test('an input subject that no row keeps is a validation error of the input alone', {
    timeout: 60_000,
  }, async () => {
    const { operator } = await boot();
    expect((await operator.attempt('casing.mention', { authorId: subject as never })).ok).toBe(
      true,
    );
    const outcome = await operator.attempt('casing.mention', { authorId: stored as never });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatchObject({ kind: 'validation' });
  });

  test('an effect input that holds the subject in upper case is a validation error', {
    timeout: 60_000,
  }, async () => {
    const { operator } = await boot();
    const outcome = await operator.attempt('casing.relay', { authorId: subject as never });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatchObject({ kind: 'validation' });
  });

  test('an item of a generated set that writes the subject in upper case fails alone', {
    timeout: 60_000,
  }, async () => {
    const { operator } = await boot();
    const outcome = (await operator.invoke('casing.entry.set', {
      create: [{ ownerId: stored as never, title: 't' }],
    })) as { failed: { operation: string; code: string }[] };
    expect(outcome.failed).toMatchObject([{ operation: 'create', code: 'core.validation' }]);
  });

  test('a draft that writes the subject of a one-field data subject in upper case is a validation error', {
    timeout: 60_000,
  }, async () => {
    const { operator } = await boot();
    const outcome = await operator.attempt('casing.shout', {
      ownerId: subject as never,
      title: 't',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatchObject({ kind: 'validation' });
  });
});
