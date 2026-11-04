import type { Id } from '../ids/id.ts';

/** The fields every row has without declaring them (section 4.2). */
export interface SystemFields<Ref extends string> {
  readonly id: Id<Ref>;
  readonly createdAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
  readonly archivedAt?: Temporal.Instant | undefined;
  readonly version: number;
}
