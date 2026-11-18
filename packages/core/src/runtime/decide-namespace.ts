import type { ControlStore } from '../control/control-store.ts';
import type { EpochBumpDecision } from '../control/epoch-bump-decision.ts';
import { epochBumpsOf } from '../control/epoch-bumps-of.ts';
import type { NamespaceIdentity } from '../control/namespace-identity.ts';
import type { ScopeMark } from '../control/scope-mark.ts';
import type { ScopeLookup } from '../invoker/scope-lookup.ts';
import type { Logger } from '../observability/logger.ts';
import type { ScopeCounters } from '../storage/scope-counters.ts';
import type { QueueSource } from '../worker/queue-source.ts';
import type { Connected } from './connected.ts';
import { departedScopes } from './departed-scopes.ts';

const pageSize = 500;

/** What step (a) of the restore check decided for one namespace, and what it read to decide. */
export interface DecidedNamespace {
  readonly source: QueueSource;
  readonly recorded: NamespaceIdentity | undefined;
  readonly current: { readonly systemId: string; readonly timeline: string };
  readonly decided: readonly EpochBumpDecision[];
}

/**
 * Step (a) of the restore check (14.7.6) for one namespace, read only: its marks and counters in
 * pages of 500 and the adapter's identity, compared by `epochBumpsOf`. A mark with no counter row
 * whose scope the directory places in another namespace (it moved or was removed) is left out of
 * the comparison: it is no lost row, and it stays as it is (`departedScopes`), one info log per
 * namespace. Nothing is written; `applyNamespace` carries the decision out.
 */
export async function decideNamespace(input: {
  readonly connected: Pick<Connected, 'control' | 'deploymentId'>;
  readonly control: ControlStore;
  readonly source: QueueSource;
  readonly directory: ScopeLookup;
  readonly recorded: NamespaceIdentity | undefined;
  /** The newest anchored position of the scopes that live in this namespace, by scope id. */
  readonly anchors: ReadonlyMap<string, bigint>;
  readonly now: Temporal.Instant;
  readonly log: Logger;
}): Promise<DecidedNamespace> {
  const { control, source, recorded } = input;
  const { namespace, handle } = source;
  const marks = new Map<string, ScopeMark>();
  for (let after: string | undefined; ; ) {
    const page = await control.marks.list(namespace.id, {
      limit: pageSize,
      ...(after === undefined ? {} : { after }),
    });
    for (const mark of page) marks.set(mark.scopeId, mark);
    const last = page.at(-1);
    if (last === undefined || page.length < pageSize) break;
    after = last.scopeId;
  }
  const counters = new Map<string, ScopeCounters>();
  for (let after: string | undefined; ; ) {
    const page: readonly ScopeCounters[] = await handle.adapter.unit(
      namespace,
      { level: 'namespace', reason: 'restore check' },
      async (unit) =>
        unit.counters?.list({ limit: pageSize, ...(after === undefined ? {} : { after }) }) ?? [],
      { readOnly: true },
    );
    for (const row of page) counters.set(row.scopeId, row);
    const last = page.at(-1);
    if (last === undefined || page.length < pageSize) break;
    after = last.scopeId;
  }
  const vanished = [...marks.keys()].filter((scopeId) => !counters.has(scopeId));
  if (vanished.length > 0) {
    const departed = await departedScopes({
      connected: input.connected,
      directory: input.directory,
      namespaceId: namespace.id,
      scopeIds: vanished,
    });
    for (const scopeId of departed) marks.delete(scopeId);
    if (departed.size > 0) {
      input.log.info('marks of scopes that live in another namespace are left as they are', {
        namespace: namespace.id,
        count: departed.size,
      });
    }
  }
  const current = await handle.adapter.identity();
  const decided = epochBumpsOf({
    recorded,
    current,
    namespaceId: namespace.id,
    now: input.now,
    marks,
    counters,
    anchors: input.anchors,
    epochs: control.epochs(),
  });
  return { source, recorded, current, decided };
}
