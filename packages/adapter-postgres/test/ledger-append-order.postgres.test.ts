import type { DataAdapter, ErasureRecord, NamespaceRef, Unit } from '@keelwerk/core';
import { aesKeyWrapper } from '@keelwerk/data/conformance';
import { keepIdleClients } from '@keelwerk/testing/postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { postgresAdapter } from '../src/postgres-adapter.ts';
import { createTestDatabase } from './support/create-test-database.ts';
import { testEnvironment } from './support/test-environment.ts';

/** The control root: its ledger table is a step of the schema the adapter provisions. */
const control: NamespaceRef = {
  id: 'ns-ledger-order',
  placementId: 'main',
  appId: 'conf',
  tenantId: null,
  root: 'kw__control',
};

let adapter: DataAdapter;
let adminUrl = '';

beforeAll(async () => {
  const urls = await createTestDatabase('ledger_append_order');
  adminUrl = urls.adminUrl;
  adapter = postgresAdapter({
    ownerUrl: urls.adminUrl,
    keyWrapper: aesKeyWrapper(new Uint8Array(32).fill(7)),
  }).create(
    {
      id: 'main',
      strategy: 'shared-tables',
      url: urls.appUrl,
      pool: { max: 6, ...keepIdleClients },
    },
    testEnvironment(),
  );
  await adapter.connect();
  await adapter.schema.provision(control, []);
});

afterAll(async () => {
  await adapter?.close(5000);
});

beforeEach(async () => {
  const owner = new pg.Client({ connectionString: adminUrl });
  await owner.connect();
  try {
    await owner.query('truncate "kw__control".kw_ledger restart identity');
  } finally {
    await owner.end();
  }
});

const run = <T>(fn: (unit: Unit) => Promise<T>): Promise<T> =>
  adapter.unit(control, { level: 'deployment' }, fn);

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function erasure(n: number): ErasureRecord {
  return {
    type: 'erasure',
    tenantId: '00000000-0000-4000-8000-0000000000a1',
    subjectId: `00000000-0000-4000-8000-00000000f${String(n).padStart(3, '0')}`,
    recordedAt: '2026-11-11T10:00:00.000Z',
    requester: { kind: 'operator', id: null, via: 'core.operator' },
    reason: 'subjectRequest',
    commandId: `00000000-0000-4000-8000-00000000e${String(n).padStart(3, '0')}`,
  };
}

function ledgerOf(unit: Unit) {
  if (unit.ledger === undefined) throw new Error('the deployment unit has no ledger');
  return unit.ledger;
}

describe('the control ledger on PostgreSQL', () => {
  test('two appends at once commit in sequence order: a poll never skips a record', async () => {
    const hold = Promise.withResolvers<void>();
    const inserted = Promise.withResolvers<void>();
    // The first append has its seq and stays uncommitted.
    const first = run(async (unit) => {
      await ledgerOf(unit).append(erasure(1));
      inserted.resolve();
      await hold.promise;
    });
    await inserted.promise;
    // The second append starts behind it. Without the lock it would commit first, a poll would see
    // only its seq, move past the first one and never read it.
    let secondCommitted = false;
    const second = run((unit) => ledgerOf(unit).append(erasure(2))).then(() => {
      secondCommitted = true;
    });
    await pause(500);
    const early = await run((unit) => ledgerOf(unit).since(0n, 10));
    expect(secondCommitted).toBe(false);
    expect(early).toEqual([]);
    hold.resolve();
    await Promise.all([first, second]);
    const found = await run((unit) => ledgerOf(unit).since(0n, 10));
    expect(
      found.map((entry) => (entry.record.type === 'erasure' ? entry.record.commandId : '')),
    ).toEqual([erasure(1).commandId, erasure(2).commandId]);
    expect(found[0] !== undefined && found[1] !== undefined && found[0].seq < found[1].seq).toBe(
      true,
    );
  });
});
