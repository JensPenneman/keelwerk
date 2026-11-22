import type { DataAdapter, QuotaLimit, QuotaLimits, Registry } from '@keelwerk/core';
import { createCommandRunner } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { behaviours, bookEntity, loanEntity } from './support/command-kit.ts';
import { command, effectEntity, registryWith } from './support/effects-kit.ts';
import { ada, call, kit, otherTenant, otherTenantId } from './support/invoker-kit.ts';
import { quotasOf, withRequestRates } from './support/rate-quota-kit.ts';
import { namespace, open, tenant } from './support/run-read-kit.ts';
import { storedRecords } from './support/stored-bytes.ts';

interface Writes {
  readonly write: {
    readonly library: { readonly book: { create(values: Record<string, unknown>): unknown } };
  };
}

const addsBook = (input: { readonly isbn?: string }, ctx: Writes) => [
  ctx.write.library.book.create({ title: 'Ran', isbn: input.isbn ?? 'none', addedBy: 'ada' }),
];

const launches = (input: { readonly isbn?: string }, ctx: Writes) => ({
  events: addsBook(input, ctx),
  effects: [{ kind: 'enqueue', type: 'enqueue', action: 'library.later', input: {} } as const],
});

const fansOut = (input: { readonly isbn?: string }, ctx: Writes) => ({
  events: addsBook(input, ctx),
  effects: [
    {
      kind: 'invoke',
      type: 'invoke',
      action: 'library.later',
      input: {},
      prefer: 'async',
    } as const,
  ],
});

const registry: Registry = registryWith({
  actions: [
    command('add', addsBook),
    command('slow', addsBook, { execution: 'async' }),
    command('launch', launches),
    command('later', () => [], { execution: 'either' }),
    command('fanout', fansOut),
  ],
});

const adaOfOther = {
  ...ada,
  headers: { ...ada.headers, 'x-tenant': otherTenantId },
};

/** Limits of the tests: a count per tenant and dimension, and a queued cap per tenant. */
function fakeQuotas(
  rows: { a: number; b: number },
  queued: { a: number; b: number },
  bytes = 1_000_000,
): QuotaLimits & { rows: { a: number; b: number } } {
  const isOther = (scope: { level: string; tenantId?: string }) => scope.tenantId === otherTenantId;
  return {
    rows,
    ...quotasOf({
      limitOf: withRequestRates((_registry, scope, ref): QuotaLimit => {
        const own = isOther(scope) ? rows.b : rows.a;
        return ref === 'core.rows'
          ? { kind: 'count', value: own }
          : { kind: 'bytes', value: bytes };
      }),
      queueOf: (scope) => ({
        running: 4,
        queued: isOther(scope) ? queued.b : queued.a,
        weight: 1,
      }),
    }),
  };
}

function setup(quotas: QuotaLimits | undefined) {
  const adapter: DataAdapter = open([bookEntity, loanEntity, effectEntity]);
  const built = kit({
    registry,
    adapter,
    build: { id: 'build-42', revision: 7 },
    ...(quotas === undefined ? {} : { quotas }),
    commands: createCommandRunner({
      deploymentId: '0198a1e0-0000-7000-8000-00000000d001',
      behaviours: () => behaviours,
      retry: { sleep: async () => undefined },
    }),
  });
  let counter = 0;
  const isbnOf = (commandId: string | undefined): string => {
    counter += 1;
    return commandId ?? String(counter);
  };
  const invoke = (action: string, carrier: typeof ada, commandId?: string) =>
    built.invoker.invoke(
      call(
        action,
        { isbn: isbnOf(commandId) },
        { carrier, ...(commandId === undefined ? {} : { commandId }) },
      ),
    );
  const usage = (scope: typeof tenant, dimension: string) =>
    adapter.unit(namespace, scope, (unit) => unit.usage.get(dimension));
  const books = (scope: typeof tenant) =>
    adapter.unit(
      namespace,
      scope,
      async (unit) => (await unit.rows.find(bookEntity, {})).rows.length,
    );
  const queued = (scope: typeof tenant) =>
    adapter.unit(namespace, scope, (unit) => unit.jobs.queued('commands', 100));
  const stored = () => storedRecords(adapter, namespace, tenant, registry);
  return { invoke, usage, books, queued, stored };
}

const idOne = '00000000-0000-7000-8000-000000000001';
const idTwo = '00000000-0000-7000-8000-000000000002';

describe('the commit tail quotas through the kernel', () => {
  test('tenant A over core.rows gets core.quota_exceeded and writes nothing while tenant B writes', async () => {
    const quotas = fakeQuotas({ a: 1, b: 10 }, { a: 10, b: 10 });
    const { invoke, usage, books } = setup(quotas);
    expect((await invoke('library.add', ada)).ok).toBe(true);
    const refused = await invoke('library.add', ada);
    expect(refused).toMatchObject({
      ok: false,
      error: {
        kind: 'rate_limited',
        code: 'core.quota_exceeded',
        retryable: false,
        details: { dimension: 'core.rows', limit: 1, value: 2 },
      },
    });
    expect(await books(tenant)).toBe(1);
    expect(await usage(tenant, 'core.rows')).toBe(1n);
    expect((await invoke('library.add', adaOfOther)).ok).toBe(true);
    expect((await invoke('library.add', adaOfOther)).ok).toBe(true);
    expect(await books(otherTenant)).toBe(2);
    expect(await usage(otherTenant, 'core.rows')).toBe(2n);
  });

  test('core.eventBytes refuses what the unit stored, meta included, and the counter keeps what committed', async () => {
    const probe = setup(undefined);
    expect((await probe.invoke('library.add', ada)).ok).toBe(true);
    const one = await probe.usage(tenant, 'core.eventBytes');
    // Meta decides it: what one command stored is more than the bytes of its data and before images.
    const { events } = await probe.stored();
    const dataAndBefore = events.reduce(
      (sum, event) =>
        sum +
        Buffer.byteLength(JSON.stringify(event.data ?? null)) +
        (event.before === null ? 0 : Buffer.byteLength(JSON.stringify(event.before))),
      0,
    );
    expect(events.length).toBeGreaterThan(0);
    expect(one).toBeGreaterThan(BigInt(dataAndBefore));
    // The limit admits one command and not the second: only the records of both together pass it.
    const { invoke, usage, books } = setup(
      fakeQuotas({ a: 10, b: 10 }, { a: 10, b: 10 }, Number(one) + 1),
    );
    expect((await invoke('library.add', ada)).ok).toBe(true);
    const refused = await invoke('library.add', ada);
    expect(refused).toMatchObject({
      ok: false,
      error: { code: 'core.quota_exceeded', details: { dimension: 'core.eventBytes' } },
    });
    expect(await books(tenant)).toBe(1);
    expect(await usage(tenant, 'core.eventBytes')).toBe(one);
  });

  test('without quotas the counters still count', async () => {
    const { invoke, usage } = setup(undefined);
    expect((await invoke('library.add', ada)).ok).toBe(true);
    expect(await usage(tenant, 'core.rows')).toBe(1n);
    expect(await usage(tenant, 'core.eventBytes')).toBeGreaterThan(0n);
  });

  test('a quota_exceeded failure is pinned to the command id', async () => {
    const quotas = fakeQuotas({ a: 0, b: 10 }, { a: 10, b: 10 });
    const { invoke, books } = setup(quotas);
    const first = await invoke('library.add', ada, idOne);
    expect(first).toMatchObject({ ok: false, error: { code: 'core.quota_exceeded' } });
    quotas.rows.a = 10;
    const again = await invoke('library.add', ada, idOne);
    expect(again).toMatchObject({ ok: false, error: { code: 'core.quota_exceeded' } });
    expect(await books(tenant)).toBe(0);
    expect((await invoke('library.add', ada, idTwo)).ok).toBe(true);
  });

  test('an async command over the queued cap is core.queue_full with retryAfter while another tenant is accepted', async () => {
    const quotas = fakeQuotas({ a: 10, b: 10 }, { a: 1, b: 1 });
    const { invoke, queued } = setup(quotas);
    expect(await invoke('library.slow', ada, idOne)).toMatchObject({
      ok: true,
      receipt: { status: 'accepted' },
    });
    const full = await invoke('library.slow', ada, idTwo);
    expect(full).toMatchObject({
      ok: false,
      error: { kind: 'rate_limited', code: 'core.queue_full', retryAfter: 1 },
    });
    expect(await queued(tenant)).toBe(1);
    expect((await invoke('library.slow', adaOfOther, idTwo)).ok).toBe(true);
    expect(await queued(otherTenant)).toBe(1);
  });

  test('an enqueue effect over the cap rolls back its decision', async () => {
    const quotas = fakeQuotas({ a: 10, b: 10 }, { a: 1, b: 1 });
    const { invoke, books, queued } = setup(quotas);
    expect((await invoke('library.launch', ada)).ok).toBe(true);
    const full = await invoke('library.launch', ada);
    expect(full).toMatchObject({ ok: false, error: { code: 'core.queue_full' } });
    expect(await books(tenant)).toBe(1);
    expect(await queued(tenant)).toBe(1);
  });

  test('a deferred invoke over the cap rolls back its decision while another tenant is accepted', async () => {
    const quotas = fakeQuotas({ a: 10, b: 10 }, { a: 1, b: 1 });
    const { invoke, books, queued } = setup(quotas);
    expect((await invoke('library.fanout', ada)).ok).toBe(true);
    const full = await invoke('library.fanout', ada);
    expect(full).toMatchObject({ ok: false, error: { code: 'core.queue_full' } });
    expect(await books(tenant)).toBe(1);
    expect(await queued(tenant)).toBe(1);
    expect((await invoke('library.fanout', adaOfOther)).ok).toBe(true);
    expect(await queued(otherTenant)).toBe(1);
  });
});
