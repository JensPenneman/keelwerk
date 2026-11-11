/** One line a recording logger saw. */
export interface LoggedLine {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}
