import { erasure } from '@keelwerk/events';
import { testOperator } from '@keelwerk/testing';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type LocalPortal, startLocalPortal } from './support/local-portal.ts';
import { credentialsOf, freshPerson } from './support/people.ts';

const operator = testOperator();
const clock = { now: () => Temporal.Instant.from('2026-11-12T09:00:00Z') };
const keyed = /^kwf1\.[0-9a-f]{64}$/;

describe('the receipts of a person whose subject is erased (erasure inventory, core__command_receipt)', () => {
  const worker = erasure({ pollMs: 3_600_000 });
  let portal: LocalPortal;

  beforeAll(async () => {
    portal = await startLocalPortal('pglite', { workers: true, eventWorkers: [worker], clock });
  }, 120_000);

  afterAll(() => portal?.runtime.stop());

  test("the receipt of the module's login record is erased, the sign-up and login receipts are purged, and the reset request's receipt keeps its keyed digest", {
    timeout: 180_000,
  }, async () => {
    const person = freshPerson('receipts');
    const { runtime } = portal;
    const scope = {
      level: 'tenant',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme.id,
    } as const;
    const receipts = runtime.app.registry.entities.get('core.commandReceipt')?.descriptor;
    if (receipts === undefined) throw new Error('the portal has no core.commandReceipt');
    // The fingerprint of each receipt of the person, by action, archived and erased rows included.
    const fingerprints = () =>
      runtime.adapter.unit(
        runtime.namespace,
        scope,
        async (unit) => {
          const rows = (
            await unit.rows.find(receipts, { includeArchived: true, includeErased: true })
          ).rows;
          return new Map(rows.map((row) => [String(row.action), String(row.fingerprint)] as const));
        },
        { readOnly: true },
      );
    expect((await portal.request('auth.signUp', person)).ok).toBe(true);
    const login = await portal.request('auth.login', credentialsOf(person));
    if (!login.ok) throw login.error;
    const { sessionToken } = login.value as { sessionToken: string };
    // A request for a reset link answers accepted and sets a timer: it writes in no stream.
    expect(
      (await portal.request('auth.requestPasswordReset', { identifier: person.identifier })).ok,
    ).toBe(true);
    await runtime.drainJobs();
    const whoami = await portal.request(
      'auth.whoami',
      {},
      { headers: { authorization: `Bearer ${sessionToken}` } },
    );
    if (!whoami.ok) throw whoami.error;
    const subject = String((whoami.value as { subject: string }).subject);
    const before = await fingerprints();
    for (const action of ['auth.signUp', 'auth.login', 'auth.requestPasswordReset']) {
      expect(before.get(action), action).toMatch(keyed);
    }
    await portal
      .client(operator)
      .invoke(
        'core.eraseSubject',
        { subjectId: subject as never, reason: 'operator' },
        { prefer: 'async' },
      );
    await runtime.drainJobs();
    await worker.pass();
    await runtime.drainJobs();
    const after = await fingerprints();
    // The commands that wrote in a row the subject owns and have no principal are purged.
    expect(after.has('auth.signUp')).toBe(false);
    expect(after.has('auth.login')).toBe(false);
    // The module's own command that wrote in a stream of the subject keeps a receipt with `erased`.
    expect(after.get('auth.recordLogin')).toBe('erased');
    // The request wrote in no stream of the subject: the receipt stays as it was, with the keyed
    // digest of the address inside, until it is deleted.
    expect(after.get('auth.requestPasswordReset')).toBe(before.get('auth.requestPasswordReset'));
  });
});
