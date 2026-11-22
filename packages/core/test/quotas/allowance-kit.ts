import type { RateBucket } from '../../src/quotas/process-allowance.ts';
import type { rateFake } from './rate-fake.ts';

/** A clock the test moves. */
export function clockOf(): { now: () => Temporal.Instant; advance: (ms: number) => void } {
  let at = Temporal.Instant.from('2026-11-19T10:00:00Z');
  return {
    now: () => at,
    advance: (ms) => {
      at = at.add({ milliseconds: ms });
    },
  };
}

/** A rate bucket of the given key, capacity and refill. */
export const bucketOf = (key: string, capacity: number, refillPerSecond = 1): RateBucket => ({
  key,
  limit: { kind: 'rate', capacity, refillPerSecond },
});

/** `hold()` holds back the next unit the fake's adapter is asked for until the function it returns runs. */
export function unitGate(fake: ReturnType<typeof rateFake>): () => () => void {
  const adapter = fake.target.handle.adapter as unknown as { unit: (...args: never[]) => unknown };
  const open = adapter.unit.bind(adapter);
  const gates: Promise<void>[] = [];
  adapter.unit = async (...args: never[]) => {
    const gate = gates.shift();
    if (gate !== undefined) await gate;
    return open(...args);
  };
  return () => {
    let release: () => void = () => undefined;
    gates.push(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return release;
  };
}
