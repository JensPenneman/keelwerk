import { durationMs } from '../effects/duration-ms.ts';

/** The shortest gap between two anchors of one scope under the default cadence `'batch'` (section 15.1.8). */
const batchAnchorGapMs = 1000;

/**
 * How many milliseconds pass at least between two anchors of one scope: one second for `'batch'`
 * (every notifier batch, at most once per second per scope), else the ISO 8601 duration of
 * `anchors.every`. A text that is no duration is a `validation` error.
 */
export function anchorCadenceMs(every: string | undefined): number {
  return every === undefined || every === 'batch' ? batchAnchorGapMs : durationMs(every);
}
