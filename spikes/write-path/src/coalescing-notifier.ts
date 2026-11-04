import { Buffer } from 'node:buffer';

/**
 * The process's notifier of section 14.3.7: units report their scope after commit, and at most one
 * wake-up per namespace leaves every interval, naming the scopes that committed, from the notifier's
 * own connection (the `send` function) and never inside a writer's transaction. A payload that would
 * exceed the limit becomes a namespace-wide wake-up (`<namespace>:*`).
 */
export class CoalescingNotifier {
  readonly #send: (payload: string) => Promise<void>;
  readonly #intervalMs: number;
  readonly #maxPayloadBytes: number;
  readonly #pending = new Map<string, Set<string>>();
  #timer: ReturnType<typeof setInterval> | undefined;
  #flushing: Promise<void> | undefined;
  #notifications = 0;
  #scopes = 0;

  constructor(
    send: (payload: string) => Promise<void>,
    options: { readonly intervalMs: number; readonly maxPayloadBytes: number },
  ) {
    this.#send = send;
    this.#intervalMs = options.intervalMs;
    this.#maxPayloadBytes = options.maxPayloadBytes;
  }

  /** The unit's afterCommit hook: something committed in this scope of this namespace. */
  committed(namespace: string, scopeId: string): void {
    let scopes = this.#pending.get(namespace);
    if (scopes === undefined) {
      scopes = new Set();
      this.#pending.set(namespace, scopes);
    }
    scopes.add(scopeId);
  }

  start(): void {
    this.#timer ??= setInterval(() => {
      // A tick that finds the previous flush still running is skipped, so the rate bound holds.
      this.#flushing ??= this.flush().finally(() => {
        this.#flushing = undefined;
      });
    }, this.#intervalMs);
  }

  /** Sends one wake-up per namespace with pending scopes. */
  async flush(): Promise<void> {
    const batches = [...this.#pending];
    this.#pending.clear();
    for (const [namespace, scopes] of batches) {
      const listed = `${namespace}:${[...scopes].join(',')}`;
      const payload =
        Buffer.byteLength(listed) <= this.#maxPayloadBytes ? listed : `${namespace}:*`;
      this.#notifications += 1;
      this.#scopes += scopes.size;
      await this.#send(payload);
    }
  }

  /** Stops the timer and sends what is still pending. */
  async stop(): Promise<void> {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#flushing;
    await this.flush();
  }

  get stats(): { readonly notifications: number; readonly scopes: number } {
    return { notifications: this.#notifications, scopes: this.#scopes };
  }
}
