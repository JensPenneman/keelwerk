import type { LiveEarlier } from '@keelwerk/core';

/** What a pass found of one plan group's earlier state: the streams it asked about, and what the plan selected of them then. */
export interface BatchEarlier {
  readonly asked: ReadonlySet<string>;
  readonly earlier: LiveEarlier;
}
