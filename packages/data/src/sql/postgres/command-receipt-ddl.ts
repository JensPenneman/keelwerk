import type { EntityDescriptor } from '@keelwerk/core';
import { commandReceiptDescriptor } from './command-receipt-descriptor.ts';
import { commandReceiptTableSpec } from './command-receipt-table-spec.ts';
import { invocationTableDdl } from './invocation-table-ddl.ts';

/**
 * The receipt table as the receipt store reads and writes it, provisioned from the descriptor of
 * `core.commandReceipt`: one row per command, unique on the scope the command ran in (`scope_id`
 * holds the tenant, backend or deployment id, as in the other framework tables) and the command id
 * as the client gave it. `id` is the UUIDv8 derived from the scope id and the command id, so
 * `core.commandReceipt.get` finds the row, and `version`, `created_at` and `updated_at` are the
 * entity's system columns. The core's provisioning (WP-43) calls this with the registry's
 * descriptor (the default is the one the core module composes); a backend command's receipt in a tenant namespace is open (section 15.1.7).
 */
export function commandReceiptDdl(
  root: string,
  entity: EntityDescriptor = commandReceiptDescriptor(),
): readonly string[] {
  return invocationTableDdl(root, commandReceiptTableSpec(entity));
}
