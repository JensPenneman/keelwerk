import type { PgliteAdapter } from '../../src/pglite/index.ts';
import { namespaceRef } from './namespace-ref.ts';

/** The change-feed wake-ups the test namespace receives while `run` executes. */
export async function collectWakes(
  adapter: PgliteAdapter,
  run: () => Promise<unknown>,
): Promise<{ namespace: string; scopeIds: readonly string[] }[]> {
  const controller = new AbortController();
  const seen: { namespace: string; scopeIds: readonly string[] }[] = [];
  const reading = (async (): Promise<void> => {
    for await (const wake of adapter.feed.wake([namespaceRef], controller.signal)) seen.push(wake);
  })();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await run();
  await new Promise((resolve) => setTimeout(resolve, 20));
  controller.abort();
  await reading;
  return seen;
}
