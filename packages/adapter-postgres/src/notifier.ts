/** What `createNotifier` needs. */
export interface NotifierOptions {
  /** Sends one wake-up on the notifier's own connection: `NOTIFY kw_events, payload`. */
  send(payload: string): Promise<void>;
  /** A send that failed; polling the heads recovers the wake-up, so this only reports. */
  onError(error: unknown): void;
  /** At most one wake-up per namespace leaves in this window; default 50 (14.3.7). */
  readonly intervalMs?: number;
  /** A payload past this many bytes becomes namespace-wide; default 7500, under the 8000 of `NOTIFY`. */
  readonly maxPayloadBytes?: number;
}

/** The process's notifier of 14.3.7. */
export interface Notifier {
  /** Something committed in this scope of this namespace; call it after the commit, never inside the transaction. */
  committed(namespace: string, scopeId: string): void;
  /** Sends what is still pending and ends the notifier. */
  stop(): Promise<void>;
}

/**
 * The coalescing notifier (14.3.7, 15.2.5): scopes reported after commit collect for one window and
 * leave as one `<namespace>:<scope>,<scope>` payload per namespace, or `<namespace>:*` when the list
 * would pass the payload limit. The window opens at the first report, so an idle process holds no
 * timer and a burst of commits costs one `NOTIFY`.
 */
export function createNotifier(options: NotifierOptions): Notifier {
  const intervalMs = options.intervalMs ?? 50;
  const maxPayloadBytes = options.maxPayloadBytes ?? 7500;
  const encoder = new TextEncoder();
  const pending = new Map<string, Set<string>>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushing: Promise<void> | undefined;
  let stopped = false;

  const flush = async (): Promise<void> => {
    const batches = [...pending];
    pending.clear();
    for (const [namespace, scopes] of batches) {
      const listed = `${namespace}:${[...scopes].join(',')}`;
      const payload =
        encoder.encode(listed).byteLength <= maxPayloadBytes ? listed : `${namespace}:*`;
      try {
        await options.send(payload);
      } catch (error) {
        options.onError(error);
      }
    }
  };

  const arm = (): void => {
    if (timer !== undefined || flushing !== undefined || stopped) return;
    timer = setTimeout(() => {
      timer = undefined;
      flushing = flush().finally(() => {
        flushing = undefined;
        if (pending.size > 0) arm();
      });
    }, intervalMs);
  };

  return {
    committed: (namespace, scopeId) => {
      if (stopped) return;
      const scopes = pending.get(namespace) ?? new Set<string>();
      scopes.add(scopeId);
      pending.set(namespace, scopes);
      arm();
    },
    stop: async () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      await flushing;
      await flush();
    },
  };
}
