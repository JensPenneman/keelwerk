import type { AdapterCapabilities } from '../storage/adapter-capabilities.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';

/** A connected placement: its adapter and, once connected, what the adapter reported. */
export interface PlacementHandle {
  readonly adapter: DataAdapter;
  /** `connect()`'s answer; decides whether a second unit can be open beside a query's unit. */
  readonly capabilities?: AdapterCapabilities;
}
