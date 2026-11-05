/** Where the log lines go: standard output, or anything with `write`. */
export interface LogDestination {
  write(line: string): unknown;
}
