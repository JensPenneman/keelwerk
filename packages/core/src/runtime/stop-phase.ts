import type { Anchoring } from '../anchors/start-anchoring.ts';
import { setProcessState } from '../control/set-process-state.ts';
import type { MountHandle } from '../transport/mount-handle.ts';
import type { Connected } from './connected.ts';
import type { DrainingInvoker } from './draining-invoker.ts';
import type { HostInstance } from './host-entry.ts';
import type { Started } from './start-phase.ts';

async function within(work: Promise<unknown>, deadlineMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, deadlineMs);
  });
  try {
    await Promise.race([work.then(() => undefined), expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** What `stop` shuts down. */
export interface StopInput {
  readonly connected: Connected;
  readonly started: Started;
  readonly draining: DrainingInvoker;
  readonly mounts: readonly MountHandle[];
  /** The HTTP host the runtime built: it stops accepting before the invocations in flight drain. */
  readonly host?: HostInstance | undefined;
  readonly abort: AbortController;
  readonly anchoring: Anchoring;
}

/**
 * `stop` (section 3.3, the drain of 21.6): the process is marked `draining` and takes no new
 * invocations; the listeners stop accepting; the invocations in flight continue until the
 * deadline, which is one absolute deadline for the whole stop; the change feed ends; the chain anchors still waiting are written (within the same deadline); the process deregisters as `stopped`; the computation pool and
 * the adapters close.
 */
export async function stopPhase(input: StopInput, deadlineMs: number): Promise<void> {
  const { connected } = input;
  const due = performance.now() + deadlineMs;
  const remaining = (): number => Math.max(0, due - performance.now());
  const deadline = AbortSignal.timeout(deadlineMs);
  input.draining.drain();
  await setProcessState(connected.control, connected.processId, 'draining').catch(
    (error: unknown) => {
      connected.log.warn('the process could not be marked draining', { cause: error });
    },
  );
  // The host starts to stop before the mounts are awaited: a mount that waits for its in-flight
  // work must not leave the listeners open, and both share the one deadline.
  const hostStopped = (input.host?.stop(remaining()) ?? Promise.resolve()).catch(
    (error: unknown) => {
      connected.log.warn('the HTTP host did not stop cleanly', { cause: error });
    },
  );
  const mountsClosed = Promise.allSettled(input.mounts.map((mount) => mount.close(deadline)));
  const phasesStopped = input.started.stopPhases(deadline);
  await within(Promise.all([hostStopped, mountsClosed, phasesStopped]), remaining());
  await within(input.draining.idle(), remaining());
  input.started.unfollow();
  await within(input.started.following, remaining());
  await within(input.anchoring.stop(), remaining());
  await setProcessState(connected.control, connected.processId, 'stopped').catch(
    (error: unknown) => {
      connected.log.warn('the process could not be marked stopped', { cause: error });
    },
  );
  await connected.compute.close();
  input.abort.abort();
  await Promise.allSettled(connected.adapters.map((adapter) => adapter.close(remaining())));
}
