import type { EntityChange, LiveKernel, LiveView, Position, StorageRow } from '@keelwerk/core';
import { archivedAmongLost } from './archived-among-lost.ts';
import { loadPostImages } from './load-post-images.ts';

/**
 * Why a lost stream is gone. A subscriber that follows archived rows held the row whatever its
 * archive mark, so a row that no longer exists was purged and an erased one was erased; every other
 * subscriber, and every other loss, is `left-view`, which tells nothing about the row.
 */
function goneReason(
  view: LiveView,
  row: StorageRow | undefined,
): 'purged' | 'erased' | 'left-view' {
  if (!view.includeArchived) return 'left-view';
  if (row === undefined) return 'purged';
  return row.kwErasedAt !== undefined && row.kwErasedAt !== null ? 'erased' : 'left-view';
}

/** One step of a replay: an item to send, or the end of the stream with `reset` `resync`. */
export type ReplayStep =
  | { readonly kind: 'item'; readonly event: EntityChange<unknown> }
  | { readonly kind: 'reset' };

/** What a replay is read with. */
export interface DisclosureReplayInput {
  readonly kernel: LiveKernel;
  readonly view: LiveView;
  /** The position of the token the stream resumes from. */
  readonly since: Position;
  /** The position the live stream continues from: the replay covers (since, head]. */
  readonly head: Position;
  /** Streams judged per unit (D7: 500). */
  readonly chunk: number;
  /** The most streams a replay may judge in all; a longer gap is `uncertain` and the client resynchronises. */
  readonly limit: number;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

/**
 * The disclosure rule over a resumed range (15.2.6, D7): the streams that changed in (since, head]
 * are judged under today's permissions, a chunk of streams per read-only unit. A stream readable now
 * and matching is sent with its current row (`created` when its created event is in the range,
 * else `changed`); one the subscriber could read at `since` and cannot now is `removed` `left-view`,
 * unless it is only archived and still selected: that is `archived`, with its row when archived rows
 * are followed (and, for a subscriber that follows them, a stream whose row is gone is `purged` and an
 * erased one `erased`). A stream it never could read is not mentioned. When the evidence is insufficient, or
 * the range holds more streams than `limit`, the replay ends with a `reset`. Items carry no state: a
 * client that drops midway resumes from its earlier token.
 */
export async function* disclosureReplay(input: DisclosureReplayInput): AsyncGenerator<ReplayStep> {
  const { kernel, view } = input;
  let judged = 0;
  let since = input.since;
  for (;;) {
    const chunk = await kernel.read(
      async (unit) => {
        const replay = await view.replay(unit, {
          since,
          head: input.head,
          maxStreams: input.chunk,
        });
        const ids = [...replay.now.keys()];
        const loaded = await loadPostImages(unit, kernel.descriptor, [...ids, ...replay.lost]);
        const archived = await archivedAmongLost(unit, view, replay.lost, loaded);
        const rows = ids.flatMap((id) => {
          const row = loaded.get(id);
          return row === undefined ? [] : [row];
        });
        const shown = await view.present(unit, rows);
        return { replay, rows, shown, archived, loaded };
      },
      { timeoutMs: input.timeoutMs, signal: input.signal },
    );
    const { replay } = chunk;
    if (replay.uncertain) {
      yield { kind: 'reset' };
      return;
    }
    judged += replay.now.size + replay.lost.size;
    if (judged > input.limit) {
      yield { kind: 'reset' };
      return;
    }
    for (const [index, row] of chunk.rows.entries()) {
      const one = chunk.shown[index];
      if (one === undefined) continue;
      const created = replay.now.get(String(row.id))?.createdAfter === true;
      const archived = row.archivedAt !== undefined && row.archivedAt !== null;
      yield {
        kind: 'item',
        event: {
          type: archived ? 'archived' : created ? 'created' : 'changed',
          id: String(row.id),
          version: Number(row.version),
          row: view.project(one),
        } as EntityChange<unknown>,
      };
    }
    for (const id of replay.lost) {
      const kept = chunk.archived.get(id);
      yield {
        kind: 'item',
        event:
          kept === undefined
            ? ({
                type: 'removed',
                id,
                reason: goneReason(view, chunk.loaded.get(id)),
              } as EntityChange<unknown>)
            : ({
                type: 'archived',
                id,
                version: kept.version,
                ...(kept.row === undefined ? {} : { row: kept.row }),
              } as EntityChange<unknown>),
      };
    }
    if (!replay.hasMore) return;
    since = replay.through;
  }
}
