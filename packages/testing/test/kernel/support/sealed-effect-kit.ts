import type {
  DataAdapter,
  StorageRow,
  StoredEvent,
  StoredJob,
  SubjectId,
  Unit,
} from '@keelwerk/core';
import { openEffectInput } from '@keelwerk/core';
import { expect } from 'vitest';
import { createLocalClient } from '../../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';
import type { TestRuntimeOptions } from '../../../src/harness/test-runtime-options.ts';
import { courierApp } from './courier-kit.ts';

/** Everything a value holds as text, bytes as hex and big integers as decimals. */
export const dump = (value: unknown): string =>
  JSON.stringify(value, (_key, member: unknown) =>
    member instanceof Uint8Array
      ? Buffer.from(member).toString('hex')
      : typeof member === 'bigint'
        ? member.toString()
        : member,
  );

export async function bootCourier(
  kind: 'memory' | 'pglite' | DataAdapter,
  external?: TestRuntimeOptions<'acme'>['external'],
) {
  const runtime = await startTestRuntime(courierApp, {
    adapter: kind,
    ...(external === undefined ? {} : { external }),
  });
  const tenant = runtime.tenants.acme;
  const scope = { level: 'tenant', backendId: runtime.backendId, tenantId: tenant.id } as const;
  const ref = (name: string) => {
    const entry = runtime.app.registry.entities.get(name);
    if (entry === undefined) throw new Error(`no entity ${name}`);
    return entry;
  };
  const client = createLocalClient(runtime, { principal: testPrincipal('ada') });
  return {
    runtime,
    client,
    entry: ref,
    /** Runs `fn` over a raw unit of the tenant: below the sealing layer. */
    raw: <T>(fn: (unit: Unit) => Promise<T>): Promise<T> =>
      runtime.adapter.unit(runtime.namespace, scope, fn),
  };
}

export type BootedCourier = Awaited<ReturnType<typeof bootCourier>>;

export async function storedCourier(
  booted: BootedCourier,
  names: readonly string[] = ['core.effect', 'courier.account', 'courier.message'],
) {
  return booted.raw(async (unit) => {
    const rows: Record<string, readonly StorageRow[]> = {};
    for (const name of names) {
      rows[name] = (await unit.rows.find(booted.entry(name).descriptor, {})).rows;
    }
    const events: StoredEvent[] = [];
    for (const [type, list] of Object.entries(rows)) {
      for (const row of list)
        events.push(...(await unit.events.readStream({ type, id: String(row.id) })));
    }
    const jobs: StoredJob[] = [];
    for (const queue of ['hooks']) {
      const taken = await unit.jobs.take(queue, 'test', {
        limit: 50,
        capabilitySets: [''],
        maxRevision: 1000,
        leaseMs: 1000,
      });
      jobs.push(...taken.jobs);
    }
    return { rows, events, jobs };
  });
}

export const user = 'ada@example.org';
export const subjectLine = 'a very private subject line';
export const owner = crypto.randomUUID() as SubjectId;

/** A dotted dataSubject through rows the same decision creates seals the effect input and its record events. */
export async function dottedSubjectCase(booted: BootedCourier): Promise<void> {
  await booted.client.invoke('courier.send', { owner, subject: subjectLine, to: user });
  const result = await storedCourier(booted);
  const key = await booted.raw((unit) => unit.keys.dataKey(owner, { create: false }));
  expect(key).toBeDefined();
  const deliverEffect = result.rows['core.effect']?.find(
    (effect) => effect.type === 'courier.deliver',
  );
  expect(deliverEffect?.input).toMatchObject({ to: { $kwe: 1, k: key?.id } });
  const effectCreated = result.events.find(
    (event) => event.type === 'core.effect.created' && event.stream.id === deliverEffect?.id,
  );
  expect(dump(effectCreated?.data)).toContain('"$kwe":1');
  expect(dump(effectCreated?.data)).not.toContain(user);
  const refs = await booted.raw((unit) => unit.keys.refs(owner, null, 10));
  expect(refs).toContainEqual({ type: 'core.effect', id: String(deliverEffect?.id) });
  await booted.runtime.stop();
}

/** Personal effect input opens only through the subject key. */
export async function personalInputCase(booted: BootedCourier): Promise<void> {
  await booted.client.invoke('courier.send', { owner, subject: subjectLine, to: user });
  const entry = booted.runtime.app.registry.effects.get('courier.deliver');
  if (entry === undefined) throw new Error('no courier.deliver');
  const result = await booted.raw(async (unit) => {
    const [effect] = (
      await unit.rows.find(booted.entry('core.effect').descriptor, {
        where: { op: 'eq', field: 'type', value: 'courier.deliver' },
      })
    ).rows;
    const input = effect?.input as Record<string, unknown>;
    const before = await openEffectInput(unit, entry, String(effect?.id), input);
    await unit.keys.shred(owner);
    const after = await openEffectInput(unit, entry, String(effect?.id), input);
    return { before, after };
  });
  expect(result.before.input.to).toBe(user);
  expect(result.before.erased).toEqual([]);
  expect(result.after.erased).toEqual(['to']);
  expect(result.after.input).not.toHaveProperty('to');
  await booted.runtime.stop();
}
