import type { LiveKernel } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import type { StartLimiter } from './start-limiter.ts';

/** What the start reads of one subscription run under. */
export interface LimitedReadInput {
  readonly kernel: LiveKernel;
  readonly startUnits: StartLimiter;
  /** Ends with the subscription: a waiting read leaves the queue, a running one is aborted. */
  readonly abort: AbortController;
  /** The units that have not settled: closing the subscription waits for them. */
  readonly pending: Set<Promise<void>>;
}

/**
 * The kernel's reads for the start of a subscription: bounded by the hub's start limiter (per scope
 * and per hub), tracked until they settle, and ended with the subscription. A read that was waiting
 * when the subscription ended is `unavailable`, which the ended stream ignores.
 */
export function limitedRead(input: LimitedReadInput): LiveKernel['read'] {
  const { kernel, abort, pending } = input;
  const scope = `${kernel.target.namespace.id}\u0000${kernel.scopeId}\u0000${kernel.audience}`;
  return async (fn, options) => {
    const done = await input.startUnits.run(scope, abort.signal, () => {
      const unit = kernel.read(fn, { ...options, signal: abort.signal });
      const settled = unit.then(
        () => undefined,
        () => undefined,
      );
      pending.add(settled);
      void settled.then(() => pending.delete(settled));
      return unit.then((value) => ({ value }));
    });
    if (done === undefined) throw errors.unavailable('The live stream has ended.');
    return done.value;
  };
}
