/** A bounded cache whose entries expire after `ttlMs` (14.7.4: unwrapped keys, 60 seconds). */
export interface KeyCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  delete(key: string): void;
}

/** Options of a key cache; `now` is a monotonic millisecond source. */
export interface KeyCacheOptions {
  readonly maxEntries?: number;
  readonly ttlMs?: number;
  readonly now?: () => number;
}

/** Creates a key cache of at most `maxEntries` (default 1,024) entries living `ttlMs` (default 60,000); the oldest entry goes first. */
export function createKeyCache<V>(options: KeyCacheOptions = {}): KeyCache<V> {
  const maxEntries = options.maxEntries ?? 1024;
  const ttlMs = options.ttlMs ?? 60_000;
  const now = options.now ?? (() => performance.now());
  const entries = new Map<string, { readonly value: V; readonly expires: number }>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      if (entry.expires <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, expires: now() + ttlMs });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        entries.delete(oldest.value);
      }
    },
    delete(key) {
      entries.delete(key);
    },
  };
}
