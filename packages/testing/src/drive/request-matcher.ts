/** A request a driven handler is expected to yield (section 7.9.6). */
export type RequestMatcher =
  | {
      readonly kind: 'load';
      /** The module's name in `ctx.load`: 'accounts'. */
      readonly module: string;
      readonly entity: string;
      readonly op: string;
      readonly args: readonly unknown[];
    }
  | { readonly kind: 'id'; readonly prefix: string }
  | { readonly kind: 'random'; readonly bytes: number }
  | { readonly kind: 'flag'; readonly key: string };
