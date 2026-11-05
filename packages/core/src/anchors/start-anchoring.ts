import type { Clock } from '../kernel/clock.ts';
import type { LedgerSink } from '../kernel/ledger-sink.ts';
import type { Logger } from '../observability/logger.ts';
import { anchorScopes } from '../runtime/anchor-scopes.ts';
import type { Connected } from '../runtime/connected.ts';
import type { DeploymentDefinition } from '../runtime/deployment-definition.ts';
import type { Migrated } from '../runtime/migrate-phase.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { AnchorSinkStatus } from './anchor-sink-status.ts';
import { createAnchorWriter } from './create-anchor-writer.ts';
import type { AnchorRecord } from './newest-anchors.ts';
import { newestAnchors } from './newest-anchors.ts';

const sweepPage = 500;

/** What `startAnchoring` leaves running. */
export interface Anchoring {
  /** Ends the following of the change feeds and anchors the scopes still waiting. */
  stop(): Promise<void>;
  /** Per ledger sink: refused appends and the last failure of the anchor writer. */
  sinkStatus?(): readonly AnchorSinkStatus[];
}

/**
 * Starts the anchor writer on the notifier's batches: every namespace of this process (the control
 * namespace and the namespace of each served app on each placement that hosts it) is followed on
 * its adapter's change feed, and each wake goes to the writer, which appends the heads of the
 * scopes it names to every ledger sink at the deployment's cadence (section 15.1.8). Without
 * sinks nothing starts.
 */
export async function startAnchoring(input: {
  readonly deployment: DeploymentDefinition;
  readonly connected: Connected;
  readonly migrated: Migrated;
  readonly sinks: readonly LedgerSink[];
  readonly appIds: readonly string[];
  readonly clock: Clock;
  readonly log: Logger;
}): Promise<Anchoring> {
  const { deployment, connected, migrated, sinks, log } = input;
  if (sinks.length === 0) return { stop: async () => undefined, sinkStatus: () => [] };
  const known = new Map<string, bigint>();
  for (const [scopeId, anchor] of await newestAnchors(sinks).catch(
    () => new Map<string, AnchorRecord>(),
  )) {
    known.set(scopeId, BigInt(anchor.position));
  }
  const writer = createAnchorWriter({
    sinks,
    clock: input.clock,
    writer: { process: connected.processId, build: connected.build.id },
    resolve: (wanted) => anchorScopes(connected, migrated, wanted),
    log,
    known,
    ...(deployment.anchors === undefined ? {} : { every: deployment.anchors.every }),
  });
  const feeds = new Map<DataAdapter, NamespaceRef[]>([
    [connected.control.adapter, [connected.control.namespace]],
  ]);
  for (const [name, placement] of Object.entries(deployment.placements)) {
    const handle = connected.placements.get(name);
    if (handle === undefined) continue;
    const hosted = Array.isArray(placement.apps)
      ? (placement.apps as readonly string[])
      : undefined;
    for (const app of input.appIds) {
      if (hosted !== undefined && !hosted.includes(app)) continue;
      const namespace = await migrated.book.namespaceOf(name, app);
      const held = feeds.get(handle.adapter) ?? [];
      held.push(namespace);
      feeds.set(handle.adapter, held);
    }
  }
  // Scopes that moved after their newest anchor (commits of a process that stopped or crashed first) are anchored now and again at stop.
  const sweep = async (since: ReadonlyMap<string, bigint>): Promise<void> => {
    for (const [adapter, namespaces] of feeds) {
      for (const namespace of namespaces) {
        const marks = new Map(since);
        for (;;) {
          const moved = await adapter.unit(
            namespace,
            { level: 'namespace', reason: 'anchors' },
            (unit) => unit.events.movedScopes(marks, sweepPage),
            { readOnly: true },
          );
          await writer.anchorNow(moved.map((entry) => entry.scopeId));
          for (const entry of moved) marks.set(entry.scopeId, entry.head);
          if (moved.length < sweepPage) break;
        }
      }
    }
  };
  await sweep(known).catch((error: unknown) => {
    log.error('the chain anchors could not be caught up at start', { cause: error });
  });
  const stopping = new AbortController();
  connected.signal.addEventListener('abort', () => stopping.abort(), { once: true });
  const following = [...feeds].map(async ([adapter, namespaces]) => {
    try {
      for await (const wake of adapter.feed.wake(namespaces, stopping.signal)) {
        await writer.onBatch(wake.scopeIds).catch((error: unknown) => {
          log.error('the chain anchors could not be written', { cause: error });
        });
      }
    } catch (error) {
      if (!stopping.signal.aborted) {
        log.error('the change feed of the anchor writer failed; anchors stop for it', {
          cause: error,
        });
      }
    }
  });
  return {
    sinkStatus: () => writer.sinkStatus?.() ?? [],
    stop: async () => {
      stopping.abort();
      await Promise.allSettled(following);
      await sweep(new Map([...known, ...writer.anchoredPositions()]))
        .then(() => writer.flush())
        .catch((error: unknown) => {
          log.error('the chain anchors could not be flushed at stop', { cause: error });
        });
    },
  };
}
