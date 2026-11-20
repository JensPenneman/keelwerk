import { describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { erasureDumpApp } from './support/erasure-probe-module.ts';
import { insertUnfencedThread, kernelRows } from './support/restart-kit.ts';
import { stopMs, useRestoreKit } from './support/restore-kit.ts';
import { serviceHeader, withServiceResolver } from './support/service-resolver.ts';

describe('a placement restored from a backup on PostgreSQL (14.7.5 step 6, 14.7.6)', () => {
  const { seedAda, inTenant, startAgain, eraseAfterBackup, completionEpochs } = useRestoreKit();

  test('a placement restored from before the erasure erases the rows again and appends a second completion', {
    timeout: 240_000,
  }, async () => {
    const { sink, first, id, backup } = await eraseAfterBackup(
      async (runtime) => (await seedAda(runtime)).ada,
      async (runtime) => {
        expect((await kernelRows(runtime, 'probe.person'))[0]?.kwErasedAt ?? null).not.toBeNull();
      },
    );
    // Every table of the namespace is restored: the rows, the keys and the receipts as they were.
    // The control store keeps the erasure record, the tombstones and the completion.
    await backup.restore();
    const { runtime: again, steps } = await startAgain(first, sink);
    expect(steps).toContain('shred');
    const rows = await kernelRows(again, 'probe.person');
    expect(rows.map((row) => row.id)).toEqual([id]);
    expect(rows[0]?.kwErasedAt ?? null).not.toBeNull();
    expect(
      await inTenant(again, (unit) => unit.keys.dataKey(id, { create: false })),
    ).toBeUndefined();
    // The restore is detected (the counters lie below the mark written before the completion): the
    // tenant moves from epoch 0 to epoch 2, and the completion of epoch 0 no longer counts.
    expect(await completionEpochs(again)).toEqual([0, 2]);
  });

  test('a placement restored with only its rows, the keys and the counters left as they were, shows no restore and runs nothing; a bumped epoch runs it', {
    timeout: 240_000,
  }, async () => {
    const { sink, first, id, backup, client } = await eraseAfterBackup(
      async (runtime) => (await seedAda(runtime)).ada,
      async () => undefined,
    );
    // The counters are left as they were too: a restore that leaves no counter below its mark is
    // the one case the epoch cannot see (identity, timeline and anchors apply).
    await backup.restore(
      (table) => !['kw_subject_keys', 'kw_value_keys', 'kw_positions'].includes(table),
    );
    const unchanged = await startAgain(first, sink);
    // The keys are still destroyed and the boot destroys nothing: nothing shows a restore.
    expect(unchanged.steps).toEqual([]);
    const restored = await kernelRows(unchanged.runtime, 'probe.person');
    expect(restored.map((row) => row.id)).toEqual([id]);
    expect(restored[0]?.kwErasedAt ?? null).toBeNull();
    expect(await completionEpochs(unchanged.runtime)).toEqual([0]);
    await unchanged.runtime.stop(stopMs);

    // The epoch a detected restore bumps (here moved by hand in the control store): the erasure runs again.
    await client.query(`update "kw__control".kw_scope_marks set epoch = 1 where scope_id = $1`, [
      first.tenants.acme?.id ?? '',
    ]);
    const bumped = await startAgain(first, sink);
    expect(bumped.steps).toContain('shred');
    expect(
      (await kernelRows(bumped.runtime, 'probe.person'))[0]?.kwErasedAt ?? null,
    ).not.toBeNull();
    expect(await completionEpochs(bumped.runtime)).toEqual([0, 1]);
  });

  test('a subject that owns only a row without a personal value has no key; a placement restored from before its erasure erases the row again and refuses a new one', {
    timeout: 240_000,
  }, async () => {
    const { sink, first, id, backup, client } = await eraseAfterBackup(
      async (runtime) => {
        const passkeyUser = crypto.randomUUID();
        // The row seals nothing, as one written before the fence existed: the subject has no key.
        await insertUnfencedThread(runtime, passkeyUser);
        expect(
          await inTenant(runtime, (unit) => unit.keys.dataKey(passkeyUser, { create: false })),
        ).toBeUndefined();
        return passkeyUser;
      },
      async (runtime) => {
        expect((await kernelRows(runtime, 'probe.thread'))[0]?.kwErasedAt ?? null).not.toBeNull();
      },
    );

    // The backup holds the row and no key row of the subject; the control store is not restored.
    await backup.restore();
    const keyRows = await client.query(
      `select count(*)::int as n from "${first.namespace.root}".kw_subject_keys where subject_id = $1`,
      [id],
    );
    expect(keyRows.rows[0]?.n).toBe(0);
    const { runtime: again, steps } = await startAgain(first, sink);
    // The boot replay made the key row the erasure's step 2 makes, and destroyed it after the
    // completion: the worker runs steps 2 to 6 again.
    expect(steps).toContain('shred');
    const rows = await kernelRows(again, 'probe.thread');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kwErasedAt ?? null).not.toBeNull();
    expect(await completionEpochs(again)).toEqual([0, 2]);
    const operator = createLocalClient(again, { principal: testOperator(), tenant: 'acme' });
    const outcome = await operator.attempt('probe.open', { ownerId: id as never, title: 'new' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatchObject({ kind: 'forbidden' });
  });

  test('a placement restored from before the erasure leaves the request record of an anonymous login unopenable once the tombstone is replayed', {
    timeout: 240_000,
  }, async () => {
    const subject = crypto.randomUUID();
    const agent = 'agent-of-the-restored-subject/1.0';
    let request: { keyId: string; nonce: Uint8Array; ciphertext: Uint8Array } | undefined;
    const { sink, first, backup } = await eraseAfterBackup(
      async (runtime) => {
        const { acme } = runtime.tenants;
        if (acme === undefined) throw new Error('no tenant acme');
        const base = testCarrier(acme, testPrincipal(null));
        const outcome = await runtime.invoker.invoke({
          action: 'probe.arrive',
          input: { ownerId: subject },
          carrier: { ...base, headers: { ...base.headers, 'user-agent': agent } },
          requestId: crypto.randomUUID(),
          signal: new AbortController().signal,
          commandId: crypto.randomUUID(),
        });
        if (!outcome.ok) throw outcome.error;
        const { sessionId } = outcome.value as { sessionId: string };
        const [event] = await inTenant(runtime, (unit) =>
          unit.events.readStream({ type: 'probe.session', id: sessionId }),
        );
        const sealed = event?.decision?.request;
        if (sealed === undefined || '$kwe' in sealed) throw new Error('no sealed request');
        request = sealed;
        // The login holds the user agent under a key of its own, which opens now.
        expect(await inTenant(runtime, (unit) => unit.keys.openValue(sealed))).toBeDefined();
        return subject;
      },
      async (runtime) => {
        if (request === undefined) throw new Error('no request');
        const sealed = request;
        expect(await inTenant(runtime, (unit) => unit.keys.openValue(sealed))).toBeUndefined();
      },
    );
    // Every table of the namespace comes back as it was before the erasure, the value key included;
    // the control store keeps the tombstone the erasure recorded before it destroyed the key.
    await backup.restore();
    const { runtime: again } = await startAgain(first, sink);
    if (request === undefined) throw new Error('no request');
    const sealed = request;
    expect(await inTenant(again, (unit) => unit.keys.openValue(sealed))).toBeUndefined();
  });
});

describe('the request record of a service principal restored from a backup on PostgreSQL (14.7.5 step 5a, 14.7.6)', () => {
  const { inTenant, startAgain, eraseAfterBackup } = useRestoreKit(
    withServiceResolver(erasureDumpApp),
  );

  test('a service whose reference is a row the subject owns writes only in another row; its key stays destroyed after the restore and the tombstone replay, with one tombstone', {
    timeout: 240_000,
  }, async () => {
    const subject = crypto.randomUUID();
    let request: { keyId: string; nonce: Uint8Array; ciphertext: Uint8Array } | undefined;
    let principalKey = '';
    const { sink, first, backup } = await eraseAfterBackup(
      async (runtime) => {
        const { acme } = runtime.tenants;
        if (acme === undefined) throw new Error('no tenant acme');
        const send = async (
          action: string,
          input: unknown,
          headers: Readonly<Record<string, string>>,
          commandId: string = crypto.randomUUID(),
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
          return outcome.value as { threadId: string };
        };
        const asOperator = testCarrier(acme, testOperator()).headers ?? {};
        const ownedByS = await send('probe.open', { ownerId: subject, title: 'S' }, asOperator);
        const ownedByT = await send(
          'probe.open',
          { ownerId: crypto.randomUUID(), title: 'T' },
          asOperator,
        );
        principalKey = `principal:${ownedByS.threadId}`;
        const commandId = crypto.randomUUID();
        await send(
          'probe.stampThread',
          { threadId: ownedByT.threadId },
          {
            [serviceHeader]: JSON.stringify({ id: 'svc.node', principalId: ownedByS.threadId }),
            'user-agent': 'agent-of-the-service/1.0',
          },
          commandId,
        );
        const events = await inTenant(runtime, (unit) =>
          unit.events.readStream({ type: 'probe.thread', id: ownedByT.threadId }),
        );
        const sealed = events.find((event) => event.commandId === commandId)?.decision?.request;
        if (sealed === undefined || '$kwe' in sealed) throw new Error('no sealed request');
        request = sealed;
        // The request sits under the long-lived key of the principal id and opens now.
        expect(sealed.keyId).toBe(principalKey);
        expect(await inTenant(runtime, (unit) => unit.keys.openValue(sealed))).toBeDefined();
        return subject;
      },
      async (runtime) => {
        if (request === undefined) throw new Error('no request');
        const sealed = request;
        expect(await inTenant(runtime, (unit) => unit.keys.openValue(sealed))).toBeUndefined();
      },
    );
    await backup.restore();
    const { runtime: again } = await startAgain(first, sink);
    if (request === undefined) throw new Error('no request');
    const sealed = request;
    expect(await inTenant(again, (unit) => unit.keys.openValue(sealed))).toBeUndefined();
    expect(await inTenant(again, (unit) => unit.keys.liveValueKeys([principalKey]))).toEqual([]);
    const ledger = await again.control.adapter.unit(
      again.control.namespace,
      { level: 'deployment' },
      (unit) => unit.ledger?.since(0n, 1000) ?? Promise.resolve([]),
      { readOnly: true },
    );
    expect(
      ledger.filter(
        (entry) => entry.record.type === 'keyTombstone' && entry.record.keyId === principalKey,
      ),
    ).toHaveLength(1);
  });
});
