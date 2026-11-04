import type { RuleMatch } from '../errors/rule-match.ts';

/** What production logs when the shape stage drops a row (section 8.4). */
export interface DroppedRow {
  readonly action: string;
  readonly entity: string;
  readonly rowId: string;
  readonly rules: readonly RuleMatch[];
}
