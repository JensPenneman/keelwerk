import type { InvocationSession } from '../invoker/invocation-session.ts';
import type { LiveKernel } from './live-kernel.ts';

/** The kernels `routeSubscribe` made available per session; it is the only writer, `liveKernelOf` the only reader. */
export const liveKernelFactories: WeakMap<InvocationSession, (entity: string) => LiveKernel> =
  new WeakMap();
