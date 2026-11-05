import type { Carrier, Runtime } from '@keelwerk/core';
import { byHeader, renderTypeId } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { boot, deploymentOf } from './support/runtime-kit.ts';

const header = 'x-keelwerk-tenant';
const carrierOf = (value: string): Carrier => ({ transport: 'test', headers: { [header]: value } });

async function started(kind: 'memory' | 'pglite') {
  const runtime: Runtime = await boot(deploymentOf(kind, { tenantResolution: [byHeader(header)] }));
  const backend = await runtime.control.createBackend({
    name: 'library',
    app: 'library',
    placement: 'main',
  });
  const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 'acme' });
  return { runtime, tenant };
}

describe.each(['memory', 'pglite'] as const)('the byHeader resolver on %s (S-115)', (kind) => {
  const limit = 60_000;
  test(
    'a tnt_ TypeID of a tenant resolves that tenant',
    async () => {
      const { runtime, tenant } = await started(kind);
      const outcome = await runtime.invoker.open(carrierOf(renderTypeId('tnt', tenant.id)));
      expect(outcome.ok).toBe(true);
    },
    limit,
  );

  test(
    'a malformed value is no match, not a validation error',
    async () => {
      const { runtime } = await started(kind);
      for (const value of ['tnt_nope', 'acme', 'tnt_', '_', 'tnt_01h455vb4pex5vsknk084sn02q0']) {
        const outcome = await runtime.invoker.open(carrierOf(value));
        expect(outcome).toMatchObject({ ok: false, error: { kind: 'not_found' } });
      }
    },
    limit,
  );

  test(
    'a TypeID of another prefix is no match',
    async () => {
      const { runtime, tenant } = await started(kind);
      const outcome = await runtime.invoker.open(carrierOf(renderTypeId('bknd', tenant.id)));
      expect(outcome).toMatchObject({ ok: false, error: { kind: 'not_found' } });
    },
    limit,
  );
});
