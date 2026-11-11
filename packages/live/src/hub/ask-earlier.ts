import type { LiveView, Logger, StorageRow, Unit } from '@keelwerk/core';
import { createLiveEarlierShare } from '@keelwerk/core';
import type { BatchEarlier } from './batch-earlier.ts';
import { planGroupKey } from './plan-group-key.ts';
import type { ReaderBatch } from './reader-batch.ts';
import type { ReaderEntry } from './reader-entry.ts';
import type { ResolvedHubLimits } from './resolve-hub-limits.ts';

/** What one pass asks of its plan groups. */
export interface AskEarlierInput {
  readonly unit: Unit;
  /** Throws when the pass is past its deadline. */
  readonly expired: () => void;
  readonly carried: readonly ReaderEntry[];
  readonly views: ReadonlyMap<ReaderEntry, LiveView>;
  readonly batch: ReaderBatch;
  /** Filled with one answer per plan group that has a stream to ask about. */
  readonly earlier: Map<string, BatchEarlier>;
  readonly limits: ResolvedHubLimits;
  readonly log: Logger;
  readonly scopeId: string;
}

/**
 * The streams each plan group's listeners cannot decide (D6), asked of the group once: what the plan
 * selected at the start of the batch among the union of those streams, whatever the number of
 * listeners behind the group. The groups of a pass share one image of each stream, so the pass has a
 * budget of distinct streams: a group whose new streams pass it gets an uncertain answer, so its
 * listeners reset to `resync` instead of queueing more work in the pass's unit.
 */
export async function askEarlier(input: AskEarlierInput): Promise<void> {
  const { unit, batch, limits, log } = input;
  const wanted = new Map<string, { view: LiveView; ids: Set<string> }>();
  for (const entry of input.carried) {
    const view = input.views.get(entry);
    if (!entry.active || view === undefined) continue;
    const ids = entry.listener.undecided?.(batch) ?? [];
    if (ids.length === 0) continue;
    const key = planGroupKey(view);
    const group = wanted.get(key) ?? { view, ids: new Set<string>() };
    for (const id of ids) group.ids.add(id);
    wanted.set(key, group);
  }
  // The budget counts distinct streams: a stream a group already asked about is rebuilt once for the pass.
  const share = createLiveEarlierShare();
  const charged = new Set<string>();
  let budget = limits.maxEarlierStreams;
  for (const [key, group] of wanted) {
    const fresh = [...group.ids].filter((id) => !charged.has(id));
    if (fresh.length > budget) {
      log.warn('a live plan group was not judged: the pass has no budget left', {
        scope: input.scopeId,
        streams: fresh.length,
      });
      input.earlier.set(key, {
        asked: group.ids,
        earlier: { rows: new Map<string, StorageRow>(), uncertain: true },
      });
      continue;
    }
    budget -= fresh.length;
    for (const id of fresh) charged.add(id);
    const found = await group.view.earlier(unit, {
      since: batch.from,
      ids: [...group.ids],
      share,
    });
    input.expired();
    input.earlier.set(key, { asked: group.ids, earlier: found });
  }
}
