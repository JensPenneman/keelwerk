/** The first answer to a subscription on a socket: its head, a refusal with the error's code, or any other frame (as text). */
export type SocketSubscribeAnswer =
  | { readonly kind: 'head' }
  | { readonly kind: 'refused'; readonly code: string }
  | { readonly kind: 'other'; readonly frame: string };
