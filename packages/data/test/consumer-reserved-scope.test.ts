import type { StorageScope, Unit, WireError } from '@keelwerk/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { PgliteAdapter } from '../src/pglite/index.ts';
import { backend } from './support/backend.ts';
import { exampleNamespace } from './support/example-namespace.ts';
import { openMemory } from './support/memory-fixture.ts';
import { openClockedPglite } from './support/open-clocked-pglite.ts';

/** The scope id of a consumer's start record (15.2.3): a scope that has it cannot checkpoint or park. */
const reserved = '00000000-0000-0000-0000-000000000000';
const scope: StorageScope = { level: 'tenant', backendId: backend, tenantId: reserved };
const stream = { type: 'library.book', id: '00000000-0000-7000-8000-000000000a01' };
const error: WireError = {
  kind: 'internal',
  code: 'core.internal',
  message: '',
  retryable: false,
  requestId: 'r',
};
const invalid = { kind: 'validation', code: 'core.validation' };

function reservedCases(run: <T>(fn: (unit: Unit) => Promise<T>) => Promise<T>): void {
  test('advance, park and unpark refuse the reserved scope id with a validation error', async () => {
    await run(async (unit) => {
      await expect(unit.consumers.advance('c', reserved, 0n)).rejects.toMatchObject(invalid);
      await expect(unit.consumers.park('c', stream, 1n, error)).rejects.toMatchObject(invalid);
      await expect(unit.consumers.unpark('c', stream)).rejects.toMatchObject(invalid);
      await expect(unit.consumers.checkpoint('c', reserved)).rejects.toMatchObject(invalid);
    });
  });
}

describe('memory', () => {
  const memory = openMemory();
  reservedCases((fn) => memory.run(scope, fn));
});

describe('pglite', () => {
  let adapter: PgliteAdapter;
  beforeAll(async () => {
    adapter = await openClockedPglite();
    await adapter.schema.provision(exampleNamespace, []);
  }, 60_000);
  afterAll(async () => {
    await adapter?.close(1000);
  }, 60_000);
  reservedCases((fn) => adapter.unit(exampleNamespace, scope, fn));
});
