import { type HookEndpoint, startHookEndpoint } from './hook-endpoint.ts';
import { bootHooks, hooksApp } from './hooks-kit.ts';
import { jobSpy } from './job-spy.ts';

/**
 * The hooks app on the in-memory adapter whose job store a test watches (`spy`), with a clock fixed
 * at `start` that `advanceTo` moves. Pushes what has to be closed onto `cleanup`.
 */
export async function watchedHooks(
  start: Temporal.Instant,
  cleanup: (() => Promise<void>)[],
  answer?: (index: number) => number | 'hang',
) {
  const descriptors = new Map(
    [...hooksApp.registry.entities].map(([ref, entry]) => [ref, entry.descriptor] as const),
  );
  const watched = jobSpy((ref) => descriptors.get(ref));
  const endpoint: HookEndpoint = await startHookEndpoint(answer);
  const booted = await bootHooks({
    adapter: 'memory',
    endpoint: endpoint.url,
    clock: { now: () => start },
    external: { factory: watched.factory, url: 'memory://watched' },
  });
  cleanup.push(
    () => booted.runtime.stop(),
    () => endpoint.close(),
  );
  return { ...booted, endpoint, spy: watched.spy };
}
