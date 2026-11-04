import type { EntityDescriptor } from '@keelwerk/core';
import { buildRegistry, defineApp, errors } from '@keelwerk/core';

/** The descriptor of `core.commandReceipt` as an app without modules composes it. */
export function commandReceiptDescriptor(): EntityDescriptor {
  const { modules } = defineApp({ id: 'receipts', modules: [] });
  const registry = buildRegistry({
    kind: 'app',
    id: 'receipts',
    modules,
    execution: {},
    appActions: {},
    authorization: {},
    policies: {},
    api: null,
  });
  const entry = registry.entities.get('core.commandReceipt');
  if (entry === undefined) throw errors.internal('the core module has no commandReceipt entity');
  return entry.descriptor;
}
