import type { Hlc } from './hlc.ts';

/** What lost a last-writer-wins comparison (M6). */
export interface MergeReport {
  /** The lww fields whose proposed value lost. */
  readonly lost?: readonly string[];
  /** The clocks they lost against. */
  readonly winners?: Readonly<Record<string, Hlc>>;
}
