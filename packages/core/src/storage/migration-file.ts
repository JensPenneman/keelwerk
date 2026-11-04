import type { ConditionInput } from '../conditions/condition-input.ts';
import type { MigrationStep } from './migration-step.ts';
import type { MigrationStepContext } from './migration-step-context.ts';

/** The columns a data step's transform changes; null from the transform leaves the row alone. */
type RowPatch = Readonly<Record<string, unknown>>;

/** One migration file's `migration` export (S-56, section 14.6.2). */
export interface MigrationFile {
  /** '0002-profile-locale'. */
  readonly id: string;
  /** 'accounts' | 'auth->accounts' | 'auth[accounts]'. */
  readonly track: string;
  readonly steps: readonly MigrationStep[];
  /** Field renames (decision 55b): the kernel writes both columns while the rollout runs and reads the old one until the backfill is recorded (section 19.3). */
  readonly renames?: readonly {
    readonly entity: string;
    readonly from: string;
    readonly to: string;
  }[];
  /** Event payloads written with the previous entity schema version, upgraded on read (section 15.1.9). */
  readonly upcast?: Readonly<Record<string, (data: unknown, eventName: string) => unknown>>;
  /** The reverse: while a rollout target runs, the target writes the finalized track version through it (section 19.2). */
  readonly downcast?: Readonly<Record<string, (data: unknown, eventName: string) => unknown>>;
  /** A dialect-neutral data step: a pure per-row transform the kernel applies per tenant in batches under the system principal. */
  readonly data?: {
    readonly entity: string;
    readonly where?: ConditionInput;
    readonly transform: (row: unknown, ctx: MigrationStepContext) => RowPatch | null;
  };
}
