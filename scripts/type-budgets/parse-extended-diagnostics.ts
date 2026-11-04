function figure(output: string, label: string): number {
  const match = new RegExp(`^${label}:\\s+([\\d.]+)s?\\s*$`, 'm').exec(output);
  const value = match?.[1];
  if (value === undefined) throw new Error(`tsc printed no "${label}" line:\n${output}`);
  return Number(value);
}

/** The figures of `tsc --extendedDiagnostics` this gate reads, and the errors the run printed. */
export interface ExtendedDiagnostics {
  readonly files: number;
  readonly instantiations: number;
  readonly checkSeconds: number;
  /** Every `error TSnnnn` line, as printed. */
  readonly errors: readonly string[];
}

/** Parses the output of `tsc -p <project> --extendedDiagnostics`; throws when the statistics are missing. */
export function parseExtendedDiagnostics(output: string): ExtendedDiagnostics {
  return {
    files: figure(output, 'Files'),
    instantiations: figure(output, 'Instantiations'),
    checkSeconds: figure(output, 'Check time'),
    errors: output.split('\n').filter((line) => /\berror TS\d+:/.test(line)),
  };
}
