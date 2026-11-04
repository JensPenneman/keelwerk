import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { insertSerial } from './support/insert-serial.ts';
import { namespaceRef } from './support/namespace-ref.ts';
import { provisionedPglite } from './support/provisioned-pglite.ts';
import { runStatement } from './support/run-statement.ts';
import { serialNames } from './support/serial-names.ts';
import { storageTenant } from './support/storage-tenant.ts';
import { tenantA } from './support/tenant-a.ts';

const scope = storageTenant(tenantA);

const opened: { close(deadline: number): Promise<void> }[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const adapter of opened.splice(0)) await adapter.close(1000);
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe('a database under a directory', () => {
  test('survives a restart, with its role, rows and identity', { timeout: 60_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kw-pglite-'));
    directories.push(directory);
    const first = await provisionedPglite({ dataDir: directory });
    await first.unit(namespaceRef, scope, async (u) =>
      runStatement(u, insertSerial, [tenantA, 'durable']),
    );
    const identity = await first.identity();
    await first.close(1000);

    const second = await provisionedPglite({ dataDir: directory });
    opened.push(second);
    expect(await serialNames(second, scope)).toEqual(['durable']);
    expect(await second.identity()).toEqual(identity);
    await second.unit(namespaceRef, scope, async (u) =>
      runStatement(u, insertSerial, [tenantA, 'again']),
    );
    expect(await serialNames(second, scope)).toEqual(['again', 'durable']);
  });
});

describe('closing an adapter', () => {
  test('makes later units fail', { timeout: 60_000 }, async () => {
    const adapter = await provisionedPglite();
    opened.push(adapter);
    await adapter.close(1000);
    await expect(adapter.unit(namespaceRef, scope, async () => 1)).rejects.toThrow(
      /not connected|closed/,
    );
    expect((await adapter.health()).ok).toBe(false);
  });
});

describe('after-commit callbacks', () => {
  test('a callback that throws is reported, the unit still resolves and the others run', async () => {
    const errors: unknown[] = [];
    const ran: string[] = [];
    const adapter = await provisionedPglite({
      onAfterCommitError: (error) => errors.push(error),
    });
    opened.push(adapter);
    const result = await adapter.unit(namespaceRef, scope, async (u) => {
      u.afterCommit(() => ran.push('first'));
      u.afterCommit(() => {
        throw new Error('callback failed');
      });
      u.afterCommit(() => ran.push('last'));
      return 'committed';
    });
    expect(result).toBe('committed');
    expect(ran).toEqual(['first', 'last']);
    expect(errors).toEqual([new Error('callback failed')]);
  }, 60_000);
});
