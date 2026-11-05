import type { startRuntime } from '@keelwerk/core';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import type { Slice2 } from './slice-2.ts';

/** A backend with two tenants, `acme` and `globex`, and a signed-in client for each. */
export async function openClients(kit: Slice2, runtime: Awaited<ReturnType<typeof startRuntime>>) {
  const backend = await runtime.control.createBackend({
    name: `library-${crypto.randomUUID().slice(0, 8)}`,
    app: 'library',
    placement: 'main',
  });
  const acme = await runtime.control.createTenant({ backendId: backend.id, name: 'acme' });
  const globex = await runtime.control.createTenant({ backendId: backend.id, name: 'globex' });
  const tenants = {
    acme: { name: 'acme', id: acme.id },
    globex: { name: 'globex', id: globex.id },
  };
  const rig = {
    app: kit.app,
    tenants,
    invoker: runtime.invoker,
    head: kit.app.api?.dates.at(-1) ?? '',
  };
  const ada = createLocalClient(rig, { principal: testPrincipal('ada'), tenant: 'acme' });
  return {
    backendId: backend.id,
    tenants,
    ada,
    anonymous: createLocalClient(rig, { principal: testPrincipal(null), tenant: 'acme' }),
    inGlobex: ada.as({ tenant: 'globex' }),
  };
}
