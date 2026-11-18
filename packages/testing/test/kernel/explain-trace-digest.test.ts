import { traceCommand } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { setup } from './support/explain-kit.ts';
import type { Kind } from './support/runtime-kit.ts';
import { withDigest } from './support/with-digest.ts';

const kinds: Kind[] = ['memory', 'pglite'];

describe.each(kinds)('a trace on %s', { timeout: 60_000 }, (kind) => {
  test('a trace shows the decision base as stored and withholds a digest of 0.1.0 (WP-158)', async () => {
    const { explain, invoke, asAda, watched } = await setup(kind);
    const commandId = '00000000-0000-7000-8000-000000000002';
    expect(
      await invoke('library.addBook', { title: 'Dune', isbn: 'i-2' }, asAda, commandId),
    ).toMatchObject({ ok: true });
    const traced = await explain({ mode: 'trace', id: commandId });
    const shown = (traced.value.command as unknown as { decision: { inputDigest: string } })
      .decision.inputDigest;
    expect(shown).toMatch(/^kwb1\.[0-9a-f]{64}$/);
    // The same decision as a deployment of 0.1.0 stored it: the plain SHA-256 of the input.
    const tenantStore = [...watched.seen.entries()].find(([key]) => key.endsWith('/tenant'))?.[1];
    if (tenantStore === undefined || tenantStore.scope.level !== 'tenant') {
      throw new Error('no tenant store was opened');
    }
    const legacy = await traceCommand({
      adapter: withDigest(tenantStore.adapter, 'a'.repeat(64)),
      namespace: tenantStore.namespace,
      scope: tenantStore.scope,
      id: commandId,
    });
    expect(legacy.command.decision?.inputDigest).toBe('withheld');
    expect(JSON.stringify(legacy)).not.toContain('a'.repeat(64));
  });
});
