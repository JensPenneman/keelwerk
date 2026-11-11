import type { Condition } from '../conditions/condition.ts';

/** The parsed members of a watch input; a member of the wrong type is `validation`. */
export interface ParsedWatchInput {
  readonly filter: Condition | undefined;
  readonly ids: ReadonlySet<string> | undefined;
  readonly fields: readonly string[] | undefined;
  readonly includeArchived: boolean;
  readonly from: 'now' | 'beginning';
  readonly after: string | undefined;
  readonly partition: string | undefined;
}
