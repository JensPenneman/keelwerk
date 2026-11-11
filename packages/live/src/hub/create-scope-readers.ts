import type { DataAdapter, LiveHubServices, LiveKernel, Logger } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import type { HubReaders } from './hub-readers.ts';
import type { ResolvedHubLimits } from './resolve-hub-limits.ts';
import type { ScopeReader } from './scope-reader.ts';
import { createScopeReader } from './scope-reader.ts';

/** The wake-up loop of one namespace of one adapter, shared by the readers of its scopes. */
interface WakeGroup {
  readonly controller: AbortController;
  /** Scope id to the wake-ups its readers asked for. */
  readonly scopes: Map<string, Set<() => void>>;
  /** Settles when the loop has ended. */
  done: Promise<void>;
}

/** What every refused attach tells the caller: nothing of the bound that applied or of anyone else's load. */
const refusal = 'Live updates are not available now.';

/**
 * The readers of one hub (D2): one `ScopeReader` per (adapter, namespace, scope id, audience),
 * created on the first attach and forgotten when it stops, and one wake-up loop per (adapter,
 * namespace) that tells a reader only about its own scope. The audience is the tenant of the
 * subscribing session: tenants of one backend read a backend entity through readers of their own, so
 * a tenant's subscriptions are counted, delayed and failed under that tenant alone. The hub's total
 * of listeners is bounded here, the scope's in the reader. Nothing is shared between scopes beyond the
 * feed's own loop, so a scope that is slow or hung delays no other. Closing ends every listener
 * and stops every reader and loop; the state lives in this closure, so nothing outlives the hub.
 */
export function createScopeReaders(
  limits: ResolvedHubLimits,
  services: LiveHubServices,
): HubReaders {
  const readers = new Map<DataAdapter, Map<string, ScopeReader>>();
  const groups = new Map<DataAdapter, Map<string, WakeGroup>>();
  /** Every reader created and not yet settled, those that stopped included. */
  const created = new Set<ScopeReader>();
  const loops = new Set<Promise<void>>();
  let total = 0;
  let closed = false;

  const joinWake = (kernel: LiveKernel, wake: () => void): (() => void) => {
    const { adapter } = kernel.target.handle;
    const namespace = kernel.target.namespace;
    const known = groups.get(adapter) ?? new Map<string, WakeGroup>();
    groups.set(adapter, known);
    let group = known.get(namespace.id);
    if (group === undefined) {
      const made: WakeGroup = {
        controller: new AbortController(),
        scopes: new Map(),
        done: Promise.resolve(),
      };
      group = made;
      known.set(namespace.id, made);
      made.done = follow(adapter, namespace, made);
      loops.add(made.done);
      void made.done.then(() => loops.delete(made.done));
    }
    const mine = group;
    const wakes = mine.scopes.get(kernel.scopeId) ?? new Set<() => void>();
    mine.scopes.set(kernel.scopeId, wakes);
    wakes.add(wake);
    return () => {
      wakes.delete(wake);
      if (wakes.size === 0) mine.scopes.delete(kernel.scopeId);
      if (mine.scopes.size === 0) {
        mine.controller.abort();
        if (known.get(namespace.id) === mine) known.delete(namespace.id);
      }
    };
  };

  const follow = async (
    adapter: DataAdapter,
    namespace: LiveKernel['target']['namespace'],
    group: WakeGroup,
  ): Promise<void> => {
    // The loop serves every tenant of the namespace: its log line names the namespace and nothing else.
    const log: Logger = services.log.child({ namespace: namespace.id });
    try {
      for await (const wake of adapter.feed.wake([namespace], group.controller.signal)) {
        if (wake.namespace !== namespace.id) continue;
        for (const scopeId of wake.scopeIds) {
          for (const callback of group.scopes.get(scopeId) ?? []) callback();
        }
      }
    } catch (error) {
      if (!group.controller.signal.aborted) {
        // The readers still poll the head, so a failed feed costs latency, never an event.
        log.warn('the change feed of the live readers failed', {
          code: error instanceof Error ? error.name : 'unknown',
        });
      }
    }
  };

  return {
    attach: (kernel, listener) => {
      if (closed) throw errors.unavailable(refusal);
      if (total >= limits.maxSubscribers) {
        kernel.log.warn('a live subscription was refused', {
          bound: 'subscribers of the process',
          count: total,
          limit: limits.maxSubscribers,
        });
        throw errors.unavailable(refusal);
      }
      const { adapter } = kernel.target.handle;
      const key = `${kernel.target.namespace.id}\u0000${kernel.scopeId}\u0000${kernel.audience}`;
      const known = readers.get(adapter) ?? new Map<string, ScopeReader>();
      readers.set(adapter, known);
      let reader = known.get(key);
      if (reader === undefined) {
        const made: ScopeReader = createScopeReader({
          kernel,
          limits,
          onWake: (wake) => joinWake(kernel, wake),
          onStop: () => {
            if (known.get(key) === made) known.delete(key);
            // A stopped reader stays known to `close` until its last pass and unit have settled.
            void made.settled().then(() => created.delete(made));
          },
        });
        reader = made;
        known.set(key, made);
        created.add(made);
      }
      const detach = reader.attach(kernel, listener);
      total += 1;
      let attached = true;
      return () => {
        if (!attached) return;
        attached = false;
        total -= 1;
        detach();
      };
    },
    close: async (deadline) => {
      closed = true;
      for (const reader of [...created]) reader.close();
      for (const known of groups.values()) {
        for (const group of known.values()) group.controller.abort();
      }
      const finished = Promise.all([
        ...[...created].map((reader) => reader.settled()),
        ...loops,
      ]).then(() => undefined);
      const expired = new Promise<void>((resolve) => {
        if (deadline.aborted) resolve();
        else deadline.addEventListener('abort', () => resolve(), { once: true });
      });
      await Promise.race([finished, expired]);
    },
  };
}
