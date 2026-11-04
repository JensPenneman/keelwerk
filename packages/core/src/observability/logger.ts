/** The structured logger modules reach as `ctx.log`; the core depends only on this interface (section 11). */
export interface Logger {
  debug(message: string, fields?: Readonly<Record<string, unknown>>): void;
  info(message: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
  error(message: string, fields?: Readonly<Record<string, unknown>>): void;
  /** A logger that adds the bindings (scope ids, request id) to every line. */
  child(bindings: Readonly<Record<string, unknown>>): Logger;
}
