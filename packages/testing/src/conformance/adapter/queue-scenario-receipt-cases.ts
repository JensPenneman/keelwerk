import type { Receipt, StorageScope } from '@keelwerk/core';
import { erasePrincipals } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { expect, test } from 'vitest';
import { conformanceApp } from '../../fixtures/index.ts';
import type { ConformanceSubject } from './conformance-subject.ts';
import type { QueueScenarioKit } from './queue-scenario-kit.ts';

const { tenantA } = conformanceScopes;
const namespaceScope: StorageScope = { level: 'namespace', reason: 'conformance' };
const pastLease = 31_000;
const principal = { resolver: 'system', principalId: 'p' } as const;
const receiptEntity = conformanceApp.registry.entities.get('core.commandReceipt');

/**
 * The end of a command job and the receipt it owns (D7), through the kernel queue on every adapter:
 * no lost lease ends a command job without settling its receipt in the same commit. A job whose
 * leases were lost three times is ended by its taker, in the one unit that fails its receipt with
 * the error of a dead letter; an erasure removes the receipts of the principal except those of
 * erasure commands, and its jobs that are not running (it also removes a pending erasure command's
 * job and keeps its receipt accepted: a known defect, not a case here). The job of an accepted
 * receipt has no key, so a cancel by key cannot reach it and that way of ending has no case; the
 * other jobs of the `commands` queue that have a key (enqueue effects, resolver effects,
 * continuations) write their receipt in the unit that runs them.
 */
export function queueScenarioReceiptCases(
  kit: () => QueueScenarioKit,
  subject: Pick<ConformanceSubject, 'run' | 'read'>,
): void {
  const commandJob = (k: QueueScenarioKit, commandId: string, queue?: string) =>
    k.job(1, {
      run: { action: 'scenario.run', input: 1, commandId },
      causation: { commandId },
      ...(queue === undefined ? {} : { queue }),
    });
  const receiptOf = (commandId: string, expiresAt: Temporal.Instant): Receipt => ({
    commandId,
    action: 'scenario.run',
    fingerprint: 'f1',
    principal,
    principalResolver: principal.resolver,
    principalId: principal.principalId,
    status: 'accepted',
    outcome: null,
    apiVersion: '2026-01-01',
    request: { transport: 'rest', remoteAddress: null, userAgent: null },
    clientId: null,
    clientSeq: null,
    expiresAt,
  });
  const accept = async (k: QueueScenarioKit, commandId: string, queue?: string): Promise<void> => {
    await k.enqueue([commandJob(k, commandId, queue)]);
    const expiresAt = k.clock().now().add({ hours: 1 });
    await subject.run(tenantA, (unit) => unit.receipts.put(receiptOf(commandId, expiresAt)));
  };
  const receipt = (commandId: string) =>
    subject.read(tenantA, (unit) => unit.receipts.get(commandId));
  /** The workers w1 to w3 each take the job and lose their lease: the next take finds the limit reached. */
  const loseThreeLeases = async (k: QueueScenarioKit): Promise<void> => {
    k.script(1, ['hold', 'hold', 'hold', 'succeed']);
    for (const [index, id] of ['w1', 'w2', 'w3'].entries()) {
      const worker = await k.worker(id, 1);
      await k.until(() => k.runs.length === index + 1);
      worker.cut();
      k.clock().advance(pastLease);
    }
  };
  const failedBy = async (commandId: string) => {
    const found = await receipt(commandId);
    expect(found?.status).toBe('failed');
    expect(found?.outcome).toMatchObject({ ok: false, error: { code: 'core.job_lease_lost' } });
    return found;
  };

  test('three lost leases end the command job with its receipt: a resend finds the recorded failure, retention may purge it, nothing runs again', {
    timeout: 60_000,
  }, async () => {
    const k = kit();
    await accept(k, 'c1');
    await loseThreeLeases(k);
    await k.worker('w4');
    await k.until(async () => (await receipt('c1'))?.status === 'failed');
    const failed = await failedBy('c1');
    expect(k.runs.map((run) => run.worker)).toEqual(['w1', 'w2', 'w3']);
    // A resend claims the command id again: the receipt exists and holds the failure.
    const resent = await subject.run(tenantA, (unit) =>
      unit.receipts.claim(receiptOf('c1', k.clock().now().add({ hours: 1 }))),
    );
    expect(resent).toBe('exists');
    expect((await receipt('c1'))?.status).toBe('failed');
    // Past its expiry the receipt is one that retention purges: finished and expired.
    const expiresAt = failed?.expiresAt;
    if (expiresAt === undefined) throw new Error('the receipt has no expiry');
    k.clock().advance(expiresAt.epochMilliseconds - k.clock().now().epochMilliseconds + 1000);
    if (receiptEntity === undefined) throw new Error('the app has no receipt entity');
    const purgeable = await subject.read(tenantA, (unit) =>
      unit.rows.find(receiptEntity.descriptor, {
        where: {
          op: 'and',
          conditions: [
            { op: 'in', field: 'status', value: ['completed', 'failed'] },
            { op: 'lt', field: 'expiresAt', value: k.clock().now() },
          ],
        },
        select: ['commandId'],
        page: { first: 10 },
      }),
    );
    expect(purgeable.rows.map((row) => row.commandId)).toEqual(['c1']);
    k.resume(1);
    await k.until(() => k.runs.every((run) => run.end === 'fenced'));
    expect(await k.written()).toEqual([]);
  });

  test('a taker that dies after it took the exhausted job leaves the receipt accepted only until the next take ends the job', {
    timeout: 60_000,
  }, async () => {
    const k = kit();
    await accept(k, 'c2');
    await loseThreeLeases(k);
    // The take that finds the limit reached hands the job out; this taker never settles it.
    const [crashed] = await k.probeTake();
    expect(crashed?.leasesExhausted).toBe(true);
    expect((await receipt('c2'))?.status).toBe('accepted');
    k.clock().advance(61_000);
    await k.worker('w4');
    await k.until(async () => (await receipt('c2'))?.status === 'failed');
    await failedBy('c2');
    expect(k.runs.map((run) => run.worker)).toEqual(['w1', 'w2', 'w3']);
    k.resume(1);
    await k.until(() => k.runs.every((run) => run.end === 'fenced'));
  });

  test('an erasure removes the receipt of the principal together with its command job', {
    timeout: 60_000,
  }, async () => {
    const k = kit();
    await accept(k, 'c3', 'commands');
    const purged = await subject.run(tenantA, (unit) =>
      erasePrincipals(unit, conformanceApp.registry, ['p']),
    );
    expect(purged).toBe(2);
    expect(await receipt('c3')).toBeUndefined();
    const left = await subject.read(namespaceScope, (unit) => unit.jobs.queued('commands', 10));
    expect(left).toBe(0);
  });
}
