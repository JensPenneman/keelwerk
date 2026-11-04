/** A long-lived connection of a listener or the HTTP host (gap G1). */
export interface Connection {
  readonly id: string;
  /** 'smtp-in.mx', 'imap.imaps', 'http'. */
  readonly listener: string;
  /** After PROXY protocol or trusted-proxy rules. */
  readonly remote: { readonly address: string; readonly port: number };
  readonly local: { readonly address: string; readonly port: number };
  readonly tls?: {
    readonly serverName?: string;
    readonly protocol: string;
    readonly cipher: string;
  };
}
