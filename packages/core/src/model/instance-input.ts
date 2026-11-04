import type { Id } from '../ids/id.ts';

/** The input the kernel adds to entity-mounted instance commands. */
export interface InstanceInput<Ref extends string> {
  readonly id: Id<Ref>;
  readonly ifVersion?: number;
}
