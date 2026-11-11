/**
 * The ids a subscriber has been told are visible (15.4.3): while it is exact, it decides `removed`
 * items without a read. It holds at most its bound; past that it is partial for good, its members
 * stay exact and new ids are not recorded.
 */
export interface VisibilitySet {
  has(id: string): boolean;
  /** False when the set is full (it has then become partial and the id is not recorded). */
  add(id: string): boolean;
  delete(id: string): void;
  /** True while every id the subscriber was told about is in the set. */
  readonly exact: boolean;
  /** Declares that ids the subscriber knows are missing from the set (after a resume). */
  markPartial(): void;
  readonly size: number;
}

/** A visibility set that holds `bound` ids at most. */
export function createVisibilitySet(bound: number): VisibilitySet {
  const ids = new Set<string>();
  let exact = true;
  return {
    has: (id) => ids.has(id),
    add: (id) => {
      if (ids.has(id)) return true;
      if (ids.size >= bound) {
        exact = false;
        return false;
      }
      ids.add(id);
      return true;
    },
    delete: (id) => {
      ids.delete(id);
    },
    get exact() {
      return exact;
    },
    markPartial: () => {
      exact = false;
    },
    get size() {
      return ids.size;
    },
  };
}
