import { errors } from '../errors/errors.ts';
import type { InvocationSession } from '../invoker/invocation-session.ts';
import type { LiveKernel } from './live-kernel.ts';
import { liveKernelFactories } from './live-kernel-factories.ts';

/** The kernel `invoker.subscribe` registered for the session; `internal` for any other session. */
export function liveKernelOf(session: InvocationSession, entity: string): LiveKernel {
  const factory = liveKernelFactories.get(session);
  if (factory === undefined) {
    throw errors.internal('The live hub was called with a session no subscription registered.');
  }
  return factory(entity);
}
