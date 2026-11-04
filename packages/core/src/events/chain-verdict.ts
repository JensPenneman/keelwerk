/** The outcome of recomputing one stream's chain: how many links held, or the first one that did not. */
export type ChainVerdict =
  | { readonly ok: true; readonly checked: number }
  | {
      readonly ok: false;
      readonly checked: number;
      readonly eventId: string;
      readonly version: number;
      /** `prev_hash`: the link to the previous event is wrong; `hash`: the content no longer matches its hash; `missing`: a chain event carries no hash. */
      readonly reason: 'prev_hash' | 'hash' | 'missing';
    };
