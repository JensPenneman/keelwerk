import type { Registry, SubjectId } from '@keelwerk/core';
import { expect } from 'vitest';
import { createLocalClient } from '../../../src/harness/create-local-client.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';
import type { TestRuntimeOptions } from '../../../src/harness/test-runtime-options.ts';
import { command, effectsKit, registryWith } from './effects-kit.ts';
import { startHookEndpoint } from './hook-endpoint.ts';
import { bootHooks, probeInput } from './hooks-kit.ts';
import { drainHooks } from './hooks-reads.ts';
import { bootJournal } from './journal-kit.ts';
import { bootReactions } from './reactions-kit.ts';
import { namespace, tenant } from './run-read-kit.ts';
import { type StoredRecords, storedRecords } from './stored-bytes.ts';

/** What a case reads back from the store of the tenant `acme`. */
const readBack = (
  runtime: Pick<
    TestRuntime<{ readonly registry: Registry }, 'acme'>,
    'adapter' | 'namespace' | 'backendId' | 'tenants' | 'app'
  >,
): Promise<StoredRecords> =>
  storedRecords(
    runtime.adapter,
    runtime.namespace,
    { level: 'tenant', backendId: runtime.backendId, tenantId: runtime.tenants.acme.id },
    runtime.app.registry,
  );

/**
 * The invariant that guards the meaning of `core.eventBytes`: the counter of the tenant equals the
 * sum of the same measure recomputed from every record the tenant's store holds. A kind of record
 * that is stored and not counted, or counted twice, makes it fail.
 */
function expectCounterEqualsStored(read: StoredRecords): void {
  expect(read.stored).toBeGreaterThan(0n);
  expect(read.counted).toBe(read.stored);
}

/**
 * The hooks app: a command with `prepare` that reads the request and performs an inline effect (its
 * decision record holds a `request` and a `prepare` member; the effect records and the attempt
 * records of the inline effect), an external effect that a worker settles, an effect with a
 * continuation.
 */
export async function hooksStoredBytes(options: StoredBytesOptions): Promise<void> {
  const endpoint = await startHookEndpoint();
  const booted = await bootHooks({ ...options, endpoint: endpoint.url });
  try {
    const owner = crypto.randomUUID() as SubjectId;
    const client = createLocalClient(booted.runtime, { principal: testPrincipal(owner) });
    await client.invoke('probes.look', { owner });
    await client.invoke('hooks.notify', { payload: 'counted' });
    await client.invoke('probes.run', probeInput(owner, 'ok'));
    await drainHooks(booted);
    const read = await readBack(booted.runtime);
    const decisions = read.events
      .map((event) => event.decision)
      .filter((record) => record !== null);
    expect(decisions.some((record) => record.prepare !== undefined)).toBe(true);
    expect(decisions.some((record) => record.request !== undefined)).toBe(true);
    const types = new Set(read.events.map((event) => event.stream.type));
    expect(types).toContain('core.effect');
    expect(types).toContain('probes.target');
    expect((read.streams.get('core.effectAttempt') ?? []).length).toBeGreaterThanOrEqual(4);
    expectCounterEqualsStored(read);
  } finally {
    await booted.runtime.stop();
    await endpoint.close();
  }
}

/**
 * The journal app: a command that appends module stream records (sealed, as stored) next to the
 * page's event, and an inline reaction that appends one more record in the same unit.
 */
export async function journalStoredBytes(options: StoredBytesOptions): Promise<void> {
  const journal = await bootJournal(options);
  try {
    expect(
      (await journal.call('journal.writePage', { title: 'Day one', texts: ['alpha', 'beta'] })).ok,
    ).toBe(true);
    const read = await readBack(journal.runtime);
    expect((read.streams.get('journal.lines') ?? []).length).toBe(3);
    expectCounterEqualsStored(read);
  } finally {
    await journal.runtime.stop();
  }
}

/**
 * The relay app: the events of a command, of its inline reactions, of its asynchronous reaction
 * jobs and of a process's own stream.
 */
export async function relayStoredBytes(options: StoredBytesOptions): Promise<void> {
  const kit = await bootReactions(options);
  try {
    expect((await kit.send('acme', { channel: 'p', contact: 'ada@example.com' })).ok).toBe(true);
    await kit.settle();
    const { runtime } = kit;
    const scope = kit.scopeOf('acme');
    const read = await storedRecords(
      runtime.adapter,
      runtime.namespace,
      scope,
      runtime.app.registry,
    );
    expect(read.events.some((event) => event.type === 'relay.tally.noted')).toBe(true);
    expect(read.events.some((event) => event.stream.type === 'relay.echo')).toBe(true);
    expectCounterEqualsStored(read);
  } finally {
    await kit.stop();
  }
}

/**
 * A command accepted asynchronously stores the transient change record of its receipt (a record the
 * retention sweep of `transientRecords` removes): it is stored, and the counter leaves it out.
 */
export async function receiptStoredBytes(): Promise<void> {
  const registry = registryWith({
    actions: [command('slow', (() => []) as never, { execution: 'async' })],
  });
  const { adapter, invoke } = effectsKit(registry);
  const outcome = await invoke('library.slow', {}, { commandId: crypto.randomUUID() });
  expect(outcome).toMatchObject({ ok: true, receipt: { status: 'accepted' } });
  const read = await storedRecords(adapter, namespace, tenant, registry);
  expect(read.events.map((event) => event.stream.type)).toEqual(['core.commandReceipt']);
  expect(read.events.every((event) => event.transient)).toBe(true);
  expect(read.uncountedEvents).toHaveLength(1);
  expect(read.counted).toBe(0n);
  expect(read.stored).toBe(0n);
}

export interface StoredBytesOptions {
  readonly adapter: 'memory' | 'pglite';
  readonly external?: NonNullable<TestRuntimeOptions<'acme'>['external']>;
}
