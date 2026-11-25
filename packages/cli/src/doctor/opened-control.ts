import type { ControlReader } from './control-reader.ts';
import type { Fact } from './fact.ts';

/** What doctor holds of the control store while the checks run: the reader, or why there is none, and the closing of what was opened. */
export interface OpenedControl {
  readonly reader: Fact<ControlReader>;
  close(): Promise<void>;
}
