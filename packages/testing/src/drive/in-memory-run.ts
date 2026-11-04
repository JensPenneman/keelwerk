import type { KeelwerkError, StorageRow, StoredEvent } from '@keelwerk/core';
import type { TestApp } from '../harness/test-app.ts';
import type { TestRuntime } from '../harness/test-runtime.ts';

/** A command run on the in-memory adapter from given rows, with what it left behind. */
export interface InMemoryRun {
  readonly runtime: TestRuntime<TestApp>;
  readonly tenant: string;
  readonly commandId: string;
  readonly outcome:
    | { readonly ok: true; readonly value: unknown }
    | { readonly ok: false; readonly error: KeelwerkError };
  /** Every event of the tenant, the seeded rows' `created` events first. */
  readonly events: readonly StoredEvent[];
  /** The rows of an entity after the run. */
  rows(entity: string): Promise<readonly StorageRow[]>;
  stop(): Promise<void>;
}
