/**
 * A filter went over the bounds of `mapFilter`: `path` is the level that went over (relative to
 * the filter's own path argument) and `reason` says which bound. Free of the kernel's error
 * classes, so the wire subpath stays dependency-free; the server side turns it into a
 * `core.malformed_request`, the client reports it as an invalid input.
 */
export class FilterLimitError extends Error {
  readonly path: readonly (string | number)[];
  readonly reason: string;

  constructor(path: readonly (string | number)[], reason: string) {
    super(`${path.length === 0 ? 'filter' : path.join('.')}: ${reason}`);
    this.name = 'FilterLimitError';
    this.path = path;
    this.reason = reason;
  }
}
