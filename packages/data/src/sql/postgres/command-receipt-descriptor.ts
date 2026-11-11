import type { EntityDescriptor } from '@keelwerk/core';
import { coreEntityDescriptor } from './core-entity-descriptor.ts';

/** The descriptor of `core.commandReceipt` as an app without modules composes it. */
export function commandReceiptDescriptor(): EntityDescriptor {
  return coreEntityDescriptor('core.commandReceipt');
}
