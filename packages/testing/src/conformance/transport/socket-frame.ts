/** One frame of a socket subscription as the protocol's client classifies it. */
export type SocketFrame =
  | { readonly kind: 'item'; readonly event: unknown }
  | { readonly kind: 'control'; readonly control: 'head' | 'reset' | 'gap' }
  | { readonly kind: 'end'; readonly reason?: string }
  | { readonly kind: 'error'; readonly code: string };
