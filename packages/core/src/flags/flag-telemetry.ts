import type { FlagResolution } from '../contexts/flag-resolution.ts';
import type { Scope } from '../storage/scope.ts';
import type { FlagSpec } from './flag-spec.ts';

/** The counter of flag evaluations (20.5). */
export interface FlagTelemetry {
  /**
   * One evaluation on `keelwerk.flags.evaluations`: `{ flag, variant, reason }` plus `backend` when the scope has one (16.11.2).
   * The variant is the one `telemetryVariantOf` shows for the flag, so no caller can put a served value into a metric series.
   */
  evaluated(flag: FlagSpec, resolution: FlagResolution<unknown>, scope: Scope): void;
}
