import type { DataAdapter, StoredEvent } from '@keelwerk/core';
import { createComputePool, entityBehavioursOf, normalizeRule } from '@keelwerk/core';
import { redecide } from '@keelwerk/core/replay';
import { afterEach, describe, expect, test } from 'vitest';
import { runInMemory } from '../../src/drive/run-in-memory.ts';
import { expectReproduces } from '../../src/replay/expect-reproduces.ts';
import { tenantAddress } from '../../src/replay/tenant-address.ts';
import { clubApp } from './support/mixed-kit.ts';
import { peopleApp } from './support/personal-kit.ts';
import { pingApp } from './support/ping-kit.ts';
import { ada } from './support/runtime-kit.ts';

const text = (value: unknown): string =>
  JSON.stringify(value, (_key, member: unknown) =>
    member instanceof Uint8Array
      ? Buffer.from(member).toString('hex')
      : typeof member === 'bigint'
        ? member.toString()
        : member,
  );

describe('personal fields through the drive and replay helpers (14.7.4, S-82)', () => {
  test('seeded rows are sealed, the run reads them back plain, and the command re-decides to its record', async () => {
    const input = {
      name: 'Grace',
      email: 'Grace@Replay.example.org',
      notes: 'a private replay note',
    };
    const run = await runInMemory(peopleApp, 'people.enrol', {
      input,
      principal: ada,
      rows: {
        'people.person': [
          { name: 'Seed', email: 'seed.person@example.org', notes: 'a seeded private note' },
        ],
      },
    });
    try {
      expect(run.outcome.ok).toBe(true);
      // The helper reads through the sealing layer: values are plain, tags absent.
      const rows = await run.rows('people.person');
      expect(rows.map((row) => row.email).sort()).toEqual([
        'Grace@Replay.example.org',
        'seed.person@example.org',
      ]);
      expect(rows.every((row) => !('email__eq' in row))).toBe(true);
      // The events as stored hold no plaintext personal value.
      expect(text(run.events)).not.toMatch(/seed\.person|private replay note|Replay\.example/);
      // The re-decision compares the personal values by value, not by presence.
      const result = await expectReproduces(run.runtime, { commandId: run.commandId, input });
      expect(result.reproduced).toBe(true);
      const wrong = await expectReproduces(run.runtime, {
        commandId: run.commandId,
        input: { ...input, email: 'someone.else@example.org' },
      }).then(
        () => 'reproduced',
        (error: unknown) => (error instanceof Error ? error.message : 'failed'),
      );
      expect(wrong).not.toBe('reproduced');
    } finally {
      await run.stop();
    }
  });
});

type Run = Awaited<ReturnType<typeof runInMemory>>;

const runs: Run[] = [];
afterEach(async () => {
  await Promise.all(runs.splice(0).map((run) => run.stop()));
});

const enrolment = {
  name: 'Grace',
  email: 'grace@decision.example.org',
  notes: 'a private decision note',
};

async function enrolled(): Promise<Run> {
  const run = await runInMemory(peopleApp, 'people.enrol', { input: enrolment, principal: ada });
  runs.push(run);
  expect(run.outcome.ok).toBe(true);
  return run;
}

/** The receipt's fingerprint of the run's command. */
async function receiptFingerprint(run: Run): Promise<string> {
  const address = tenantAddress(run.runtime, run.tenant);
  const receipt = await run.runtime.adapter.unit(address.namespace, address.scope, (unit) =>
    unit.receipts.get(run.commandId),
  );
  if (receipt === undefined) throw new Error('the command left no receipt');
  return receipt.fingerprint;
}

/** The decision record's digest of the first event the command wrote. */
const digestOf = (run: Run, type?: string): string => {
  const first = run.events.find(
    (event) => event.commandId === run.commandId && (type === undefined || event.type === type),
  );
  if (first?.decision == null) throw new Error('no decision record');
  return first.decision.inputDigest;
};

/**
 * An adapter whose events read with the decision digest of `digest`, as a record of 0.1.0 would
 * hold it.
 */
function withDigest(adapter: DataAdapter, digest: string): DataAdapter {
  const rewritten = (event: StoredEvent): StoredEvent =>
    event.decision === null
      ? event
      : { ...event, decision: { ...event.decision, inputDigest: digest } };
  return {
    ...adapter,
    unit: (namespace, scope, fn, options) =>
      adapter.unit(
        namespace,
        scope,
        (unit) =>
          fn({
            ...unit,
            events: {
              ...unit.events,
              readAll: async (after, readOptions) => {
                const page = await unit.events.readAll(after, readOptions);
                return { ...page, events: page.events.map(rewritten) };
              },
            },
          }),
        options,
      ),
  };
}

async function redecideOver(run: Run, adapter: DataAdapter, input: unknown) {
  const { app } = run.runtime;
  const address = tenantAddress(run.runtime, run.tenant);
  const compute = createComputePool({ size: 1 });
  return redecide({
    registry: app.registry,
    adapter,
    namespace: address.namespace,
    scope: address.scope,
    commandId: run.commandId,
    input,
    apiVersion: run.runtime.head,
    behaviours: entityBehavioursOf(app.modules),
    rules: [...app.registry.rules.values()]
      .filter((rule) => rule.disabled !== true)
      .map(normalizeRule),
    keys: run.runtime.keys,
    compute,
    clock: run.runtime.clock,
    config: run.runtime.config,
    log: run.runtime.log,
    trace: run.runtime.tracer.startSpan('redecide'),
  }).finally(() => compute.close());
}

describe('the decision record of a decision that sealed personal values (7.9.6, WP-130)', () => {
  test('a decision that sealed a personal value holds a keyed input digest and re-decides', async () => {
    const run = await enrolled();
    const digest = digestOf(run, 'people.person.created');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    // The receipt's fingerprint is the plain digest of the input; the record is rekeyed under the
    // key of the sealed values.
    expect(digest).not.toBe(await receiptFingerprint(run));
    expect(
      (await expectReproduces(run.runtime, { commandId: run.commandId, input: enrolment }))
        .reproduced,
    ).toBe(true);
  });

  test('a decision record in the 0.1.0 form still re-decides', async () => {
    const run = await enrolled();
    const plain = await receiptFingerprint(run);
    const result = await redecideOver(run, withDigest(run.runtime.adapter, plain), enrolment);
    expect(result.reproduced).toBe(true);
  });

  test('an input that is not the recorded one is refused with either form', async () => {
    const run = await enrolled();
    await expect(
      redecideOver(run, run.runtime.adapter, { ...enrolment, notes: 'another note' }),
    ).rejects.toMatchObject({ code: 'core.validation' });
  });

  test('an effect-only decision re-decides', async () => {
    const owner = crypto.randomUUID();
    const run = await runInMemory(pingApp, 'ping.send', {
      input: { ownerId: owner, to: 'ada@decision.example.org' },
      principal: ada,
    });
    runs.push(run);
    expect(run.outcome.ok).toBe(true);
    const effectEvent = run.events.find((event) => event.stream.type === 'core.effect');
    expect(effectEvent?.decision?.inputDigest).toMatch(/^[0-9a-f]{64}$/);
    // The requested event sealed the personal input, so its record is keyed under that key.
    expect(effectEvent?.decision?.inputDigest).not.toBe(await receiptFingerprint(run));
    // The input is accepted against the rekeyed record. The events of the effect's own record
    // are the kernel's and are not re-decided, so they are the only difference.
    const input = { ownerId: owner, to: 'ada@decision.example.org' };
    const result = await redecideOver(run, run.runtime.adapter, input);
    expect(result.refused).toBeUndefined();
    expect(result.differences).toEqual(['1 events were recorded and 0 were re-decided']);
    await expect(
      redecideOver(run, run.runtime.adapter, { ...input, to: 'someone@decision.example.org' }),
    ).rejects.toMatchObject({ code: 'core.validation' });
  });

  test('a decision that sealed a personal value in a row and requested an effect with a personal input re-decides', async () => {
    const input = {
      ownerId: crypto.randomUUID(),
      name: 'Grace',
      email: 'grace@mixed.example.org',
    };
    const run = await runInMemory(clubApp, 'club.join', { input, principal: ada });
    runs.push(run);
    expect(run.outcome.ok).toBe(true);
    const entityDigest = digestOf(run, 'club.member.created');
    const effectEvent = run.events.find((event) => event.stream.type === 'core.effect');
    const effectDigest = effectEvent?.decision?.inputDigest;
    expect(entityDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(effectDigest).toMatch(/^[0-9a-f]{64}$/);
    // The effect's record is keyed again under the key of its own sealed input.
    expect(effectDigest).not.toBe(entityDigest);
    expect(entityDigest).not.toBe(await receiptFingerprint(run));
    const result = await redecideOver(run, run.runtime.adapter, input);
    expect(result.refused).toBeUndefined();
    // The row event reproduces; the effect's own record is the kernel's and is not re-decided.
    expect(result.differences).toEqual(['2 events were recorded and 1 were re-decided']);
    await expect(
      redecideOver(run, run.runtime.adapter, { ...input, email: 'someone@mixed.example.org' }),
    ).rejects.toMatchObject({ code: 'core.validation' });
  });

  test('after the erasure the re-decide answers core.replay_key_destroyed', async () => {
    const run = await enrolled();
    const personId = (
      run.events.find((event) => event.type === 'people.person.created') as StoredEvent
    ).stream.id;
    const address = tenantAddress(run.runtime, run.tenant);
    await run.runtime.adapter.unit(address.namespace, address.scope, (unit) =>
      unit.keys.shred(personId),
    );
    await expect(redecideOver(run, run.runtime.adapter, enrolment)).rejects.toMatchObject({
      code: 'core.replay_key_destroyed',
    });
  });
});
