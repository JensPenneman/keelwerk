import type { FakeHost } from './fake-host.ts';

/**
 * What `work` answers, with every timer the code under test schedules fired as soon as it exists
 * (once `gate` has settled, when there is one): the deadlines pass without anyone waiting for
 * them. With `patience`, work that is still pending after that many turns in which no new timer
 * was scheduled fails the case with a message, instead of holding it: all that is left is a wait
 * that no deadline bounds.
 */
export async function stepTimers<T>(
  host: FakeHost,
  work: Promise<T>,
  gate: Promise<unknown> = Promise.resolve(),
  patience = Number.POSITIVE_INFINITY,
): Promise<T> {
  await Promise.race([
    gate,
    work.then(
      () => undefined,
      () => undefined,
    ),
  ]);
  let settled = false;
  const finished = work.finally(() => {
    settled = true;
  });
  let seen = -1;
  let idle = 0;
  while (!settled) {
    for (const timer of host.timers) timer.fire();
    await new Promise<void>((resolve) => setImmediate(resolve));
    idle = host.timers.length === seen ? idle + 1 : 0;
    seen = host.timers.length;
    if (idle > patience) {
      throw new Error('the work is still pending and no deadline is left that could end it');
    }
  }
  return finished;
}
