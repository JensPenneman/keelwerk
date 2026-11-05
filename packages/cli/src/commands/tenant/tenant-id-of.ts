import { parseTypeId } from '@keelwerk/core';
import { backendIdOf } from '../../connections/backend-id-of.ts';
import type { CliContext } from '../../context/cli-context.ts';
import { CliFailure } from '../../context/cli-failure.ts';
import { usageFailure } from '../../context/usage-failure.ts';
import { contextLink } from './context-link.ts';

/**
 * The id of the tenant a command addresses: a TypeID is taken as given, any other text is a
 * tenant name looked up through `core.tenant.query`. A name is unique within its backend only, so
 * `backend` (a name or id) narrows it, and a name several backends hold is a usage error.
 */
export async function tenantIdOf(
  context: CliContext,
  reference: string,
  backend: string | undefined,
): Promise<string> {
  if (reference.startsWith('tnt_')) return reference;
  const backendId =
    backend === undefined ? undefined : await backendIdOf(contextLink(context), backend);
  // A filter compares stored values: a reference is the row's UUID, not its TypeID.
  const backendRow = backendId === undefined ? undefined : parseTypeId(backendId, 'bknd');
  const response = await context.client.invoke(
    'core.tenant.query',
    {
      filter: { name: reference, ...(backendRow !== undefined && { backendId: backendRow }) },
      first: 2,
    },
    { signal: context.signal },
  );
  if (!response.ok) throw new CliFailure(response.error, response.error.message);
  const items = (response.value as { readonly items?: unknown } | null)?.items;
  const rows = Array.isArray(items) ? (items as readonly Readonly<Record<string, unknown>>[]) : [];
  const found = rows.filter((row) => row.name === reference);
  const [only] = found;
  if (only === undefined || typeof only.id !== 'string') {
    throw usageFailure(`No tenant is named "${reference}".`);
  }
  if (found.length > 1) {
    throw usageFailure(`Several backends hold a tenant named "${reference}": add --backend.`);
  }
  return only.id;
}
