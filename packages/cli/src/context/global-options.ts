/** The flags that choose the connection; read before the command tree is built. */
export interface GlobalOptions {
  readonly profile?: string;
  readonly backend?: string;
  readonly tenant?: string;
  readonly socket?: string;
  readonly config?: string;
}
