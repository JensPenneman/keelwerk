import type { ControlStore } from '../control/control-store.ts';
import type { ScopeMark } from '../control/scope-mark.ts';
import type { ScopeCounters } from '../storage/scope-counters.ts';
import type { QueueSource } from '../worker/queue-source.ts';

const pageSize = 500;

/** A scope whose counters the minute loop found below the position it had seen. */
export interface RewoundScope {
  readonly counters: ScopeCounters;
  /** The position the process had seen last. */
  readonly was: bigint;
}

/**
 * Makes a rewind found under a running process durable (14.7.6): each scope's mark moves to an
 * epoch above the one the mark, the counters and the epoch cache hold, with the position and the
 * serials the process had seen. The evidence of the rewind otherwise lives in the memory of the
 * process that exits: another process could write over the rewound positions before the restart,
 * and the boot check would find the counters back at the mark. Every later boot finds the
 * counters' epoch below the mark's and bumps and raises them, and every other process takes the
 * epoch at its next read of the bumped marks, so a token of the earlier epoch answers reset.
 * Fails when the control store does; the caller still takes the process out of service.
 */
export async function bumpRewoundScopes(input: {
  readonly control: ControlStore;
  readonly source: Pick<QueueSource, 'namespace'>;
  readonly rewound: readonly RewoundScope[];
  readonly now: Temporal.Instant;
}): Promise<void> {
  const { control, source, rewound, now } = input;
  const wanted = new Set(rewound.map((entry) => entry.counters.scopeId));
  const marks = new Map<string, ScopeMark>();
  for (let after: string | undefined; ; ) {
    const page = await control.marks.list(source.namespace.id, {
      limit: pageSize,
      ...(after === undefined ? {} : { after }),
    });
    for (const mark of page) if (wanted.has(mark.scopeId)) marks.set(mark.scopeId, mark);
    const last = page.at(-1);
    if (last === undefined || page.length < pageSize) break;
    after = last.scopeId;
  }
  await control.marks.bumped();
  const epochs = control.epochs();
  for (const { counters, was } of rewound) {
    const mark = marks.get(counters.scopeId);
    const from = mark?.epoch ?? 0;
    const serials: Record<string, bigint> = { ...counters.serials };
    for (const [name, value] of Object.entries(mark?.serials ?? {})) {
      const known = serials[name];
      if (known === undefined || value > known) serials[name] = value;
    }
    let position = mark?.position ?? 0n;
    for (const seen of [was, counters.position]) if (seen > position) position = seen;
    await control.marks.bump(
      {
        scopeId: counters.scopeId,
        namespaceId: source.namespace.id,
        epoch: Math.max(from, counters.epoch, epochs.get(counters.scopeId) ?? 0, 1) + 1,
        position,
        serials,
        updatedAt: now,
      },
      from,
    );
  }
}
