import type { Empty } from '@keelwerk/core';

interface Leaf<K, I, O, Er, Ev, X> {
  readonly kind: K;
  readonly input: I;
  readonly output: O;
  readonly errors: Er;
  readonly events: Ev;
  readonly execution: X;
}

/** A hand-written action tree: the shapes `AppActionTree` gives, with `Temporal` and `bigint` in them. */
interface ProbeTree {
  readonly shop: {
    readonly actions: {
      readonly total: Leaf<
        'query',
        { readonly since: Temporal.Instant },
        { readonly total: bigint; readonly at: Temporal.Instant },
        never,
        never,
        'sync'
      >;
      readonly place: Leaf<
        'command',
        { readonly sku: string; readonly quantity: bigint },
        { readonly orderId: string; readonly placedAt: Temporal.Instant },
        {
          readonly code: 'shop.sold_out';
          readonly data: { readonly sku: string; readonly left: bigint };
        },
        never,
        'either'
      >;
      readonly cancelAll: Leaf<
        'command',
        Empty,
        { readonly cancelled: number },
        never,
        never,
        'async'
      >;
      readonly ping: Leaf<'command', undefined, undefined, never, never, 'sync'>;
      readonly feed: Leaf<'subscription', Empty, never, never, { readonly n: number }, 'sync'>;
    };
    readonly entities: Empty;
  };
}

/** An app value type with the phantom `~types` member the typed client reads. */
export interface ProbeApp {
  readonly '~types'?: {
    readonly actions: 'shop.total' | 'shop.place' | 'shop.cancelAll' | 'shop.ping' | 'shop.feed';
    readonly tree: ProbeTree;
  };
}
