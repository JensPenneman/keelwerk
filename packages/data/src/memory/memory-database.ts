import type { Clock, NamespaceRef } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import type { MemoryNamespace } from './memory-namespace.ts';
import { memoryNamespace } from './memory-namespace.ts';

/** The state of one adapter instance: its namespaces, locks and listeners. */
export interface MemoryDatabase {
  readonly clock: Clock;
  /** The id of the deployment: the scope id of its deployment-scope units. */
  readonly deploymentId: string;
  readonly cluster: { readonly systemId: string; readonly timeline: string };
  /** The namespace of a ref, created empty on first use. */
  namespace(ref: NamespaceRef): MemoryNamespace;
  /** Waits for the key's turn; the returned function ends it. Units of one namespace queue on `ref.id`. */
  lock(key: string): Promise<() => void>;
  /** Called after a commit that assigned positions: wakes the feed. */
  committed(namespaceId: string, scopeId: string): void;
  /** Registers a feed listener; the returned function removes it. */
  listen(listener: (namespaceId: string, scopeId: string) => void): () => void;
  isClosed(): boolean;
  close(): void;
}

/**
 * Creates the state of one adapter. A lock is a promise chain per key, so waiting units run in
 * the order they asked; everything is closed over here and shared by no one else.
 */
export function memoryDatabase(
  clock: Clock,
  cluster: { readonly systemId: string; readonly timeline: string },
  deploymentId: string,
): MemoryDatabase {
  const namespaces = new Map<string, MemoryNamespace>();
  const tails = new Map<string, Promise<void>>();
  const listeners = new Set<(namespaceId: string, scopeId: string) => void>();
  let closed = false;
  return {
    clock,
    deploymentId,
    cluster,
    namespace: (ref) => {
      let found = namespaces.get(ref.id);
      if (found === undefined) {
        found = memoryNamespace(ref);
        namespaces.set(ref.id, found);
      }
      return found;
    },
    lock: async (key) => {
      if (closed) throw errors.unavailable('the in-memory adapter is closed');
      const previous = tails.get(key) ?? Promise.resolve();
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const tail = previous.then(() => gate);
      tails.set(key, tail);
      await previous;
      return () => {
        release();
        if (tails.get(key) === tail) tails.delete(key);
      };
    },
    committed: (namespaceId, scopeId) => {
      for (const listener of listeners) listener(namespaceId, scopeId);
    },
    listen: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isClosed: () => closed,
    close: () => {
      closed = true;
    },
  };
}
