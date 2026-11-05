import type { CliContext } from '../../context/cli-context.ts';
import { CliFailure } from '../../context/cli-failure.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { scopeOutput } from '../../routes/scope-output.ts';

function pageInfoOf(value: unknown): Readonly<Record<string, unknown>> | undefined {
  const info = (value as { readonly pageInfo?: unknown } | null)?.pageInfo;
  return typeof info === 'object' && info !== null
    ? (info as Readonly<Record<string, unknown>>)
    : undefined;
}

function nextCursor(value: unknown): string | undefined {
  const info = pageInfoOf(value);
  return info?.hasNextPage === true && typeof info.endCursor === 'string'
    ? info.endCursor
    : undefined;
}

function itemsOf(value: unknown): readonly unknown[] {
  const items = (value as { readonly items?: unknown } | null)?.items;
  return Array.isArray(items) ? items : [];
}

function joinPages(first: unknown, next: unknown): unknown {
  return { ...(first as object), items: [...itemsOf(first), ...itemsOf(next)] };
}

/**
 * Invokes one deployment-level action on the connected deployment's operator endpoint and prints
 * what it answers; a refusal ends the command with the exit code of its kind.
 */
export async function runOperatorAction(
  context: CliContext,
  flags: Readonly<Record<string, unknown>>,
  action: string,
  input: Readonly<Record<string, unknown>>,
  present: (value: unknown) => unknown = (value) => value,
  options: { readonly allPages?: boolean } = {},
): Promise<void> {
  const scoped = scopeOutput(context, flags);
  try {
    let response = await scoped.client.invoke(action, input, { signal: scoped.signal });
    if (!response.ok) throw new CliFailure(response.error, response.error.message);
    let value = response.value;
    // A page answer holds `items` and `pageInfo`: with `allPages`, follow `endCursor` to the last page.
    for (let next = nextCursor(value); options.allPages === true && next !== undefined; ) {
      response = await scoped.client.invoke(
        action,
        { ...input, after: next },
        { signal: scoped.signal },
      );
      if (!response.ok) throw new CliFailure(response.error, response.error.message);
      value = joinPages(value, response.value);
      next = nextCursor(response.value);
    }
    scoped.output.value(present(value));
  } catch (failure) {
    handleFailure(scoped, failure);
  }
}
