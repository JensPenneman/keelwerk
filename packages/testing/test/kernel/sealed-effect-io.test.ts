import type { StorageRow, StoredEvent, StoredJob, SubjectId, Unit } from '@keelwerk/core';
import {
  defineApp,
  defineEffect,
  defineModule,
  defineModuleBase,
  field,
  openEffectInput,
  shape,
} from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { findPlaintext } from '../../src/dump/find-plaintext.ts';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { courierApp } from './support/courier-kit.ts';

/** Everything a value holds as text, bytes as hex and big integers as decimals. */
const dump = (value: unknown): string =>
  JSON.stringify(value, (_key, member: unknown) =>
    member instanceof Uint8Array
      ? Buffer.from(member).toString('hex')
      : typeof member === 'bigint'
        ? member.toString()
        : member,
  );

async function boot(kind: 'memory' | 'pglite') {
  const runtime = await startTestRuntime(courierApp, { adapter: kind });
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

type Booted = Awaited<ReturnType<typeof boot>>;

async function stored(
  booted: Booted,
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

const user = 'ada@example.org';
const subjectLine = 'a very private subject line';
const owner = crypto.randomUUID() as SubjectId;

// The SQL adapters keep no table for the `core.effect` records yet (its entity has the `invocation`
// tenancy of receipts), so the tests that write an effect run on the in-memory adapter only.
describe.each(['memory', 'pglite'] as const)(
  'sealed effect input and output on %s (S-127)',
  (kind) => {
    test.runIf(kind === 'memory')(
      'the hooks sketch effect and a personal effect compose and record requested with no plaintext in a dump',
      {
        timeout: 90_000,
      },
      async () => {
        const booted = await boot(kind);
        const commandId = crypto.randomUUID();
        await booted.client.invoke(
          'courier.send',
          { owner, subject: subjectLine, to: user },
          { commandId },
        );
        const result = await stored(booted);
        expect(result.rows['core.effect']).toHaveLength(2);
        expect(result.jobs).toHaveLength(1);
        expect(result.jobs[0]?.run).toEqual({
          executor: 'courier.post',
          effect: result.rows['core.effect']?.find((effect) => effect.type === 'courier.post')?.id,
        });
        const receipt = await booted.raw((unit) => unit.receipts.get(commandId));
        const text = dump({ ...result, receipt });
        expect(findPlaintext(text, [user, 'plain-signing-key-1', subjectLine])).toEqual([]);
        expect(text).toContain('kwv1.');
        await booted.runtime.stop();
      },
    );

    test('the created event and the state row of a row sealed through a row of the same decision carry the subject key', {
      timeout: 90_000,
    }, async () => {
      const booted = await boot(kind);
      await booted.client.invoke('courier.open', { owner, subject: subjectLine });
      const result = await stored(booted, ['courier.account', 'courier.message']);
      const key = await booted.raw((unit) => unit.keys.dataKey(owner, { create: false }));
      expect(key).toBeDefined();
      const [row] = result.rows['courier.message'] ?? [];
      expect(row?.subject).toBeInstanceOf(Uint8Array);
      const created = result.events.find((event) => event.type === 'courier.message.created');
      const values = (created?.data ?? {}) as { values?: { subject?: unknown } };
      expect(values.values?.subject).toMatchObject({ $kwe: 1, k: key?.id });
      expect(dump(result)).not.toContain(subjectLine);
      await booted.runtime.stop();
    });

    test.runIf(kind === 'memory')(
      'a dotted dataSubject through rows the same decision creates seals the effect input and its record events',
      {
        timeout: 90_000,
      },
      async () => {
        const booted = await boot(kind);
        await booted.client.invoke('courier.send', { owner, subject: subjectLine, to: user });
        const result = await stored(booted);
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
      },
    );

    test('a row a later draft creates is no hop: the command fails with validation and writes nothing', {
      timeout: 90_000,
    }, async () => {
      const booted = await boot(kind);
      const attempt = await booted.client.attempt('courier.sendReversed', {
        owner,
        subject: subjectLine,
        to: user,
      });
      expect(attempt).toMatchObject({
        ok: false,
        error: { kind: 'validation', issues: [{ path: ['subject'] }] },
      });
      const result = await stored(booted, ['courier.account', 'courier.message']);
      expect(result.rows['courier.message']).toEqual([]);
      expect(result.rows['courier.account']).toEqual([]);
      await booted.runtime.stop();
    });

    test.runIf(kind === 'memory')(
      'personal effect input opens only through the subject key',
      {
        timeout: 90_000,
      },
      async () => {
        const booted = await boot(kind);
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
      },
    );

    test('a secret command output is sealed in its receipt and answered again on replay', {
      timeout: 90_000,
    }, async () => {
      const booted = await boot(kind);
      const commandId = crypto.randomUUID();
      const first = await booted.client.attempt('courier.issue', {}, { commandId });
      const second = await booted.client.attempt('courier.issue', {}, { commandId });
      expect(first).toMatchObject({ ok: true, value: { apiKey: 'plain-api-key-1' } });
      expect(second).toMatchObject({ ok: true, value: { apiKey: 'plain-api-key-1' } });
      const receipt = await booted.raw((unit) => unit.receipts.get(commandId));
      const text = dump(receipt);
      expect(text).toMatch(/kwv1\./);
      expect(text).not.toContain('plain-api-key-1');
      await booted.runtime.stop();
    });
  },
);

describe('a sealed value cannot be moved into another effect', () => {
  test('a reference from a client is refused and writes no effect', {
    timeout: 90_000,
  }, async () => {
    const booted = await boot('memory');
    const foreign =
      'kwv1.0198a1e0-0000-7000-8000-00000000c001.CQkJCQkJCQkJCQkJ.AAAAAAAAAAAAAAAAAAAAAA';
    const attempt = await booted.client.attempt('courier.forward', {
      key: { ref: foreign } as never,
    });
    expect(attempt).toMatchObject({
      ok: false,
      error: {
        kind: 'validation',
        message: 'courier.post.signingKey takes a plain secret or a reference its module loaded.',
      },
    });
    const result = await stored(booted, ['core.effect']);
    expect(result.rows['core.effect']).toEqual([]);
    const plain = await booted.client.attempt('courier.forward', { key: 'plain-signing-key-3' });
    expect(plain).toMatchObject({ ok: true });
    await booted.runtime.stop();
  });

  test('a with member the continuation declares secret is refused', {
    timeout: 90_000,
  }, async () => {
    const booted = await boot('memory');
    const refusedAttempt = await booted.client.attempt('courier.chain', {
      token: 'plain-token-1',
      note: 'n',
    });
    expect(refusedAttempt).toMatchObject({
      ok: false,
      error: { code: 'core.request_not_allowed' },
    });
    const allowed = await booted.client.attempt('courier.chain', { note: 'a note' });
    expect(allowed).toMatchObject({ ok: true });
    const result = await stored(booted, ['core.effect']);
    expect(result.rows['core.effect']).toHaveLength(1);
    expect(dump(result)).not.toContain('plain-token-1');
    await booted.runtime.stop();
  });
});

describe('effect declarations', () => {
  test('an effect with a personal input and no subject is refused at compose', () => {
    const base = defineModuleBase({ id: 'bare', version: '0.1.0' });
    const notify = defineEffect(base, {
      performer: 'external',
      input: shape({ to: field.string().personal() }),
    });
    const bare = defineModule(base, { effects: { notify } });
    expect(() => defineApp({ id: 'bare', modules: [bare] })).toThrow(/^effectInputNeedsSubject:/);
  });
});
