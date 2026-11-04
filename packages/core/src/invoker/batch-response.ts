import type { InvokeResponse } from './invoke-response.ts';

export interface BatchResponse {
  readonly results: readonly InvokeResponse[];
}
