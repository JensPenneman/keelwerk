import { describe, expect, test } from 'vitest';
import { conformanceApp } from '../../src/fixtures/index.ts';
import { withTestResolver } from '../../src/harness/with-test-resolver.ts';
import { slice2Adapters } from '../support/slice-2-adapters.ts';
import { pgliteFactory } from './support/pglite-factory.ts';
import { boot, deploymentOf } from './support/runtime-kit.ts';

describe('development migrate over a migrated track with a contributing module', () => {
  test('applies the files of library first, then provisions the tracks without files, so no table is created twice', {
    timeout: 60_000,
  }, async () => {
    const runtime = await boot(
      deploymentOf('pglite', { apps: [withTestResolver(conformanceApp)] }),
    );
    const backend = await runtime.control.createBackend({
      name: 'library',
      app: 'conformance',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 'acme' });
    expect(tenant.id).toEqual(expect.any(String));
  });

  test('a second boot on the same database finds nothing to apply or create', {
    timeout: 60_000,
  }, async () => {
    const adapters = slice2Adapters(pgliteFactory(), true);
    try {
      for (const round of [1, 2]) {
        const runtime = await boot(
          deploymentOf('pglite', {
            apps: [withTestResolver(conformanceApp)],
            factory: adapters.factory,
          }),
        );
        const backend = await runtime.control.createBackend({
          name: `library-${round}`,
          app: 'conformance',
          placement: 'main',
        });
        const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 'acme' });
        expect(tenant.id).toEqual(expect.any(String));
        await runtime.stop(1000);
      }
      const history = await adapters.adapter('main').schema.history(adapters.namespace());
      expect(new Set(history.map((entry) => `${entry.track}/${entry.id}`)).size).toBe(
        history.length,
      );
    } finally {
      await adapters.closeAll();
    }
  });
});
