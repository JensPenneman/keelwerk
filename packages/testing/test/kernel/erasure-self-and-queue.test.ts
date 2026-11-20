import { afterEach, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { dumpDatabase, findPlaintext } from '../../src/index.ts';
import { pgliteQuery, sectionsOf } from './support/dump-sections.ts';
import { bootErasureRules, ledgerOf, stopBooted } from './support/erasure-rules-kit.ts';
import { useUpperDraws } from './support/use-upper-draws.ts';

useUpperDraws();

afterEach(stopBooted);

describe('a user erasing their own subject (the rule the probe module contributes, 14.7.5)', () => {
  test('may erase their own subject, not another, and the erasure completes', {
    timeout: 60_000,
  }, async () => {
    const { runtime, worker, operator, subject } = await bootErasureRules();
    const bea = String(
      (
        (await operator.invoke('probe.enrol', {
          name: 'Bea',
          email: 'rules.bea@example.test',
        })) as {
          personId: string;
        }
      ).personId,
    );
    const own = createLocalClient(runtime, { principal: testPrincipal(subject), tenant: 'acme' });
    const refused = await own.attempt(
      'core.eraseSubject',
      { subjectId: bea as never, reason: 'subjectRequest' } as never,
      { prefer: 'async' },
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatchObject({ kind: 'forbidden' });
    expect(await ledgerOf(runtime)).toEqual([]);

    const accepted = await own.invoke(
      'core.eraseSubject',
      { subjectId: subject as never, reason: 'subjectRequest' } as never,
      { prefer: 'async' },
    );
    const commandId = String((accepted as { commandId: string }).commandId);
    await runtime.drainJobs();
    await worker.pass();
    const scope = {
      level: 'tenant',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme.id,
    } as const;
    // The subject is its own principal: the purge of its receipts must leave this one for step 6.
    const receipt = await runtime.sealed.unit(runtime.namespace, scope, (unit) =>
      unit.receipts.get(commandId),
    );
    expect(receipt?.status).toBe('completed');
    expect((await ledgerOf(runtime)).map((entry) => entry.record.type)).toEqual([
      'erasure',
      'keyTombstone',
      'erasureCompleted',
    ]);
    // Bea is untouched.
    const descriptor = runtime.app.registry.entities.get('probe.person')?.descriptor;
    if (descriptor === undefined) throw new Error('no probe.person');
    const rows = await runtime.sealed.unit(
      runtime.namespace,
      scope,
      async (unit) => (await unit.rows.find(descriptor, {})).rows,
    );
    expect(rows.map((row) => row.id)).toEqual([bea]);
  });
});

describe('what an erasure leaves in the queue', () => {
  test('a waiting job an operator started about the subject is unreadable once the subject is erased', {
    timeout: 120_000,
  }, async () => {
    const address = 'rules.defer.marker@example.test';
    const { runtime, worker, operator, subject } = await bootErasureRules('pglite', {
      frozenClock: true,
    });
    await operator.invoke(
      'probe.defer',
      { address, ownerId: subject as never },
      { prefer: 'async' },
    );
    await runtime.drainJobs();
    const query = pgliteQuery(runtime.adapter);
    // The text of a row holds the envelope's `k` member with doubled quotes, as a composite does.
    const keysOf = (section: string): string[] =>
      [
        ...section.matchAll(
          /\bk\W{1,8}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g,
        ),
      ].map((match) => match[1] ?? '');
    const jobsOf = async (): Promise<{ text: string; dump: string }> => {
      const dump = await dumpDatabase(query);
      const text = [...sectionsOf(dump)]
        .filter(([name]) => name.endsWith('.kw_jobs'))
        .map(([, rows]) => rows)
        .join('\n');
      return { text, dump };
    };
    const scope = {
      level: 'tenant',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme.id,
    } as const;
    const before = await jobsOf();
    // The job waits for its next attempt, with the address sealed under the subject's key.
    expect(before.text).toContain('probe.defer');
    expect(before.dump).not.toContain(address);
    const [keyId] = keysOf(before.text);
    expect(keyId).toBeDefined();
    const opens = (id: string) =>
      runtime.sealed.unit(
        runtime.namespace,
        scope,
        async (unit) => (await unit.keys.keyById(id)) !== undefined,
      );
    expect(await opens(keyId ?? '')).toBe(true);

    await operator.invoke(
      'core.eraseSubject',
      { subjectId: subject as never, reason: 'subjectRequest' } as never,
      { prefer: 'async' },
    );
    await runtime.drainJobs();
    await worker.pass();
    // The operator's job is not purged (neither its principal nor its causation is the subject), but
    // the key its sealed member opens with is destroyed, so the address cannot be read from it.
    const after = await jobsOf();
    expect(after.text).toContain('probe.defer');
    expect(await opens(keyId ?? '')).toBe(false);
    expect(findPlaintext(after.dump, [address])).toEqual([]);
  });
});
