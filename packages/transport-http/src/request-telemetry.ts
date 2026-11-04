import type { RequestState } from './request-state.ts';

/** One server span per request plus the request metrics (section 16.11). */
export interface RequestTelemetry {
  /** Opens the span and counts the request; the returned function ends both with the final status. */
  begin(request: Request, state: RequestState): (status: number) => void;
}
