import type { InvokeRequest } from './invoke-request.ts';

/** Up to 20 invocations, executed in order, each independently (section 16.8.2). */
export interface BatchRequest {
  readonly invocations: readonly InvokeRequest[];
}
