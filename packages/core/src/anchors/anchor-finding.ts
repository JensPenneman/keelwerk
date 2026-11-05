/** One way a scope disagrees with the ledger's anchors (section 15.1.8). */
export type AnchorFinding =
  | {
      /** No event at the anchored position: the chain was rewound or events were removed. */
      readonly kind: 'missing';
      readonly scopeId: string;
      readonly position: string;
    }
  | {
      /** The event at the anchored position has another hash or stream: the chain was rewritten. */
      readonly kind: 'mismatch';
      readonly scopeId: string;
      readonly position: string;
      readonly anchoredHash: string;
      readonly foundHash: string | null;
    }
  | {
      /** The scope's head lies below its newest anchor: the database was restored from an older copy. */
      readonly kind: 'behind';
      readonly scopeId: string;
      readonly head: string | null;
      readonly newest: string;
    };
