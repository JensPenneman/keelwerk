import { CliFailure } from '../context/cli-failure.ts';
import type { DeploymentLink } from '../context/deployment-link.ts';
import { usageFailure } from '../context/usage-failure.ts';

/**
 * The id of the backend a command addresses: a TypeID is taken as given, any other text is a
 * backend name looked up through `core.backend.query` over a deployment-level link (names are
 * unique, S-26). Headers carry ids, so a name is resolved once before tenant-scoped requests.
 */
export async function backendIdOf(
  link: Pick<DeploymentLink, 'invoke'>,
  reference: string,
  signal?: AbortSignal,
): Promise<string> {
  if (reference.startsWith('bknd_')) return reference;
  const response = await link.invoke(
    { action: 'core.backend.query', input: { filter: { name: reference }, first: 1 } },
    signal === undefined ? undefined : { signal },
  );
  if (!response.ok) throw new CliFailure(response.error, response.error.message);
  const items = (response.value as { readonly items?: unknown } | null)?.items;
  const rows = Array.isArray(items) ? (items as readonly Readonly<Record<string, unknown>>[]) : [];
  const found = rows.find((row) => row.name === reference);
  if (typeof found?.id !== 'string') throw usageFailure(`No backend is named "${reference}".`);
  return found.id;
}
