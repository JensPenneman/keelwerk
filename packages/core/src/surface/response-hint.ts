/** How an HTTP transport carries an output (section 16.2.2). */
export type ResponseHint =
  | { readonly kind: 'json' }
  | { readonly kind: 'raw'; readonly contentType: string; readonly from: string }
  | { readonly kind: 'redirect'; readonly from: string; readonly status?: 302 | 303 | 307 }
  | { readonly kind: 'download'; readonly from: string }
  | { readonly kind: 'empty'; readonly status?: 202 | 204 };
