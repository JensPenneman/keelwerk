import type { PgliteAdapter } from '../../src/pglite/index.ts';
import { exampleNamespace } from './example-namespace.ts';
import { storeControlNamespace } from './store-control-namespace.ts';

/** Provisions the namespace at root `example` and the control store's root. */
export async function provisionExampleRoots(adapter: PgliteAdapter): Promise<void> {
  await adapter.schema.provision(exampleNamespace, []);
  await adapter.schema.provision(storeControlNamespace, []);
}
