import type { WireError } from '@keelwerk/core';
import type { OutputFormat } from './output-format.ts';

/** What a command can choose once its flags are parsed. */
export interface OutputChoice {
  readonly format?: OutputFormat;
  readonly fields?: readonly string[];
}

/** Where a command's results and errors go (section 16.9.5); the formats are text, table, json, yaml and ndjson. */
export interface OutputWriter {
  readonly format: OutputFormat;
  /** The same streams with the format and fields a command's flags chose. */
  using(choice: OutputChoice): OutputWriter;
  /** A result: a row, a page, a receipt or any value. */
  value(value: unknown): void;
  /** A plain line on standard output. */
  line(text: string): void;
  /** An error on standard error. */
  error(error: WireError): void;
  /** A plain line on standard error. */
  note(text: string): void;
}
