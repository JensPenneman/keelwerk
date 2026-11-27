import type { StorageRow } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { erasureLinkedApp } from './support/erasure-grant-apps.ts';
import { erasureDumpApp } from './support/erasure-probe-module.ts';
import { bootErasureRules, ledgerOf, stopBooted } from './support/erasure-rules-kit.ts';
import { insertUnfencedThread, kernelRows, scopeOf } from './support/restart-kit.ts';

afterEach(stopBooted);

type Runtime = TestRuntime<typeof erasureDumpApp>;

const reason = 'operator';

/** The rows an ordinary read sees. */
function visibleRows(runtime: Runtime, ref: string): Promise<readonly StorageRow[]> {
  const descriptor = runtime.app.registry.entities.get(ref)?.descriptor;
  if (descriptor === undefined) throw new Error(`no entity ${ref}`);
  return runtime.adapter.unit(
    runtime.namespace,
    scopeOf(runtime),
    async (unit) => (await unit.rows.find(descriptor, {})).rows,
    { readOnly: true },
  );
}

/** The streams the subject's key references: only rows with a personal value have one. */
function referencesOf(runtime: Runtime, subject: string) {
  return runtime.adapter.unit(
    runtime.namespace,
    scopeOf(runtime),
    (unit) => unit.keys.refs(subject, null, 100),
    { readOnly: true },
  );
}

/** A client that calls the linked module's actions, which the probe app's type does not know. */
const asLinked = (client: unknown) =>
  client as {
    invoke: (action: string, input: unknown, options?: unknown) => Promise<unknown>;
    attempt: (
      action: string,
      input: unknown,
      options?: unknown,
    ) => Promise<{ ok: boolean; error?: unknown }>;
  };

const erase = (client: unknown, subjectId: string) =>
  asLinked(client).invoke('core.eraseSubject', { subjectId, reason }, { prefer: 'async' });

describe('the lookup of owned rows asks the composition for an index (14.7.5)', () => {
  test('a data subject without an index is a warning of the app, and the person, which is its own subject, is none', () => {
    const warned = erasureDumpApp.registry.problems.filter(
      (problem) => problem.code === 'dataSubjectUnindexed',
    );
    expect(warned.map((problem) => `${problem.severity} ${problem.ref}`)).toEqual([
      'warning probe.thread',
      'warning relay.signal',
    ]);
    expect(warned[0]?.message).toContain('probe.thread.ownerId');
  });
});

describe('rows a subject owns that hold no personal value (14.7.5)', () => {
  test('a subject that never had a key keeps a shredded key row, so a later row for it is refused', {
    timeout: 60_000,
  }, async () => {
    const { runtime, worker, operator } = await bootErasureRules();
    const subject = crypto.randomUUID();
    // A row written without the sealing unit (as before the fence existed): no key was ever made.
    await insertUnfencedThread(runtime, subject);
    const keyOf = (create: boolean) =>
      runtime.adapter.unit(runtime.namespace, scopeOf(runtime), (unit) =>
        unit.keys.dataKey(subject, { create }),
      );
    expect(await keyOf(false)).toBeUndefined();
    expect(await erase(operator, subject)).toMatchObject({ status: 'accepted' });
    await runtime.drainJobs();
    await worker.pass();
    expect((await kernelRows(runtime, 'probe.thread'))[0]?.kwErasedAt).toBeDefined();
    // The key row exists and is shredded: creating a key finds it and answers nothing.
    expect(await keyOf(true)).toBeUndefined();
    const outcome = await operator.attempt('probe.open', {
      ownerId: subject as never,
      title: 'new',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatchObject({ kind: 'forbidden' });
  });

  test('a row with a one-field data subject and no personal member is erased, archived and invisible', {
    timeout: 60_000,
  }, async () => {
    const { runtime, worker, operator } = await bootErasureRules();
    const passkeyUser = crypto.randomUUID();
    await operator.invoke('probe.open', { ownerId: passkeyUser as never, title: 'no secret' });
    // The row seals nothing, so no reference points at it: only the lookup per entity can find it.
    expect(await referencesOf(runtime, passkeyUser)).toEqual([]);
    expect(await erase(operator, passkeyUser)).toMatchObject({ status: 'accepted' });
    await runtime.drainJobs();
    await worker.pass();
    const [row, ...rest] = await kernelRows(runtime, 'probe.thread');
    expect(rest).toEqual([]);
    expect(row?.kwErasedAt).toBeDefined();
    expect(row?.archivedAt).toBeDefined();
    expect(await visibleRows(runtime, 'probe.thread')).toEqual([]);
    expect((await ledgerOf(runtime)).map((entry) => entry.record.type)).toContain('erasure');
  });

  test('a row on a reference path that holds no personal member is erased', {
    timeout: 60_000,
  }, async () => {
    const { runtime, worker, operator } = await bootErasureRules('memory', {
      app: erasureLinkedApp,
    });
    const owner = crypto.randomUUID();
    await asLinked(operator).invoke('linked.linkLeaf', { owner, label: 'plain' });
    expect(await referencesOf(runtime, owner)).toEqual([]);
    await erase(operator, owner);
    await runtime.drainJobs();
    await worker.pass();
    const [leaf, ...rest] = await kernelRows(runtime, 'linked.leaf');
    expect(rest).toEqual([]);
    expect(leaf?.kwErasedAt).toBeDefined();
    expect(await visibleRows(runtime, 'linked.leaf')).toEqual([]);
  });

  test('a contributed rule grants the erasure of a subject whose only row, on a reference path, holds no personal member', {
    timeout: 60_000,
  }, async () => {
    const { runtime, operator } = await bootErasureRules('memory', { app: erasureLinkedApp });
    const owner = crypto.randomUUID();
    await asLinked(operator).invoke('linked.linkLeaf', { owner, label: 'plain' });
    const own = createLocalClient(runtime, { principal: testPrincipal(owner), tenant: 'acme' });
    expect(await erase(own, owner)).toMatchObject({ status: 'accepted' });
    const stranger = createLocalClient(runtime, {
      principal: testPrincipal('someone'),
      tenant: 'acme',
    });
    const refused = await asLinked(stranger).attempt(
      'core.eraseSubject',
      { subjectId: owner, reason },
      { prefer: 'async' },
    );
    expect(refused.ok).toBe(false);
  });

  test('after the shred no row can be created for the subject, in either spelling', {
    timeout: 60_000,
  }, async () => {
    const { runtime, worker, operator } = await bootErasureRules();
    const subject = crypto.randomUUID();
    await operator.invoke('probe.open', { ownerId: subject as never, title: 'first' });
    await erase(operator, subject);
    await runtime.drainJobs();
    await worker.pass();
    for (const spelling of [subject, subject.replaceAll('-', '')]) {
      const outcome = await operator.attempt('probe.open', {
        ownerId: spelling as never,
        title: 'after',
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error).toMatchObject({ kind: 'forbidden' });
    }
    expect(await visibleRows(runtime, 'probe.thread')).toEqual([]);
  });

  test('a run that crashed right after the unit that erased a row purges the receipts of its principal when it is repaired', {
    timeout: 60_000,
  }, async () => {
    let crash = true;
    const { runtime, worker, operator } = await bootErasureRules('memory', {
      app: erasureLinkedApp,
      erasure: {
        afterStep: async (step) => {
          if (step === 'streams' && crash) {
            crash = false;
            throw new Error('crash after the first erased row');
          }
        },
      },
    });
    const owner = crypto.randomUUID();
    const made = (await asLinked(operator).invoke('linked.linkLeaf', {
      owner,
      label: 'plain',
    })) as {
      leafId: string;
    };
    // A session-like principal: its id is the id of the owned row, so its receipts belong to the subject.
    const session = createLocalClient(runtime, {
      principal: testPrincipal(made.leafId),
      tenant: 'acme',
    });
    await asLinked(session).invoke(
      'linked.touch',
      {},
      { commandId: '00000000-0000-7000-8000-000000000001' },
    );
    const receiptsOf = (id: string) =>
      runtime.adapter.unit(
        runtime.namespace,
        scopeOf(runtime),
        async (unit) => {
          const descriptor = runtime.app.registry.entities.get('core.commandReceipt')?.descriptor;
          if (descriptor === undefined) throw new Error('no receipts');
          return (
            await unit.rows.find(descriptor, {
              where: { op: 'eq', field: 'principalId', value: id },
              includeArchived: true,
            })
          ).rows;
        },
        { readOnly: true },
      );
    expect(await receiptsOf(made.leafId)).toHaveLength(1);
    await erase(operator, owner);
    await runtime.drainJobs();
    await worker.pass();
    // The run stopped right after the unit that erased the row, which purges nothing: the purge
    // runs afterwards, in units of its own.
    expect((await kernelRows(runtime, 'linked.leaf'))[0]?.kwErasedAt).toBeDefined();
    expect(await receiptsOf(made.leafId)).toHaveLength(1);
    await worker.pass();
    expect(await receiptsOf(made.leafId)).toEqual([]);
  });
});
